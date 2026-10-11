package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"cyclesafe/internal/models"
	"cyclesafe/internal/network"
	"cyclesafe/internal/simulator"
)

type sumoSimulationResponse struct {
	Source               string              `json:"source"`
	ScenarioID           string              `json:"scenario_id"`
	LaneType             string              `json:"lane_type"`
	ConflictCategory     string              `json:"conflict_category"`
	EgoAgentType         string              `json:"ego_agent_type"`
	CounterpartAgentType string              `json:"counterpart_agent_type"`
	Points               []sumoPointResponse `json:"points"`
	Metadata             map[string]any      `json:"metadata"`
}

type sumoPointResponse struct {
	Seq                  int      `json:"seq"`
	Lat                  float64  `json:"lat"`
	Lon                  float64  `json:"lon"`
	AccelX               float64  `json:"accel_x"`
	AccelY               float64  `json:"accel_y"`
	AccelZ               float64  `json:"accel_z"`
	GyroA                float64  `json:"gyro_a"`
	GyroB                float64  `json:"gyro_b"`
	GyroC                float64  `json:"gyro_c"`
	LinAccelX            float64  `json:"lin_accel_x"`
	LinAccelY            float64  `json:"lin_accel_y"`
	LinAccelZ            float64  `json:"lin_accel_z"`
	ObsDistLeftM         *float64 `json:"obs_dist_left_m"`
	ObsDistRightM        *float64 `json:"obs_dist_right_m"`
	ObsDistSameLaneM     *float64 `json:"obs_dist_same_lane_m"`
	TimestampMs          int64    `json:"timestamp_ms"`
	ScenarioID           string   `json:"scenario_id"`
	LaneType             string   `json:"lane_type"`
	EgoAgentType         string   `json:"ego_agent_type"`
	ConflictCategory     string   `json:"conflict_category"`
	CounterpartAgentID   string   `json:"counterpart_agent_id"`
	CounterpartAgentType string   `json:"counterpart_agent_type"`
}

type sumoJobResponse struct {
	JobID      string                  `json:"job_id"`
	Status     string                  `json:"status"`
	Step       int                     `json:"step"`
	TotalSteps int                     `json:"total_steps"`
	Progress   float64                 `json:"progress"`
	Error      string                  `json:"error,omitempty"`
	Result     *sumoSimulationResponse `json:"result,omitempty"`
}

type simulationStatusResponse struct {
	JobID      string       `json:"job_id"`
	Status     string       `json:"status"`
	Step       int          `json:"step,omitempty"`
	TotalSteps int          `json:"total_steps,omitempty"`
	Progress   float64      `json:"progress"`
	Ride       *models.Ride `json:"ride,omitempty"`
	Error      string       `json:"error,omitempty"`
}

func (a *App) Simulate(w http.ResponseWriter, r *http.Request) {
	config := network.Load()
	scenarioID := r.URL.Query().Get("scenario")
	if scenarioID == "" {
		scenarioID = r.URL.Query().Get("scenario_id")
	}
	if scenarioID == "" {
		scenarioID = config.DefaultScenarioID
	}
	scenario, err := config.SelectScenario(scenarioID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	// Legacy SimRa-schema sample fixture
	if r.URL.Query().Get("source") == "sample" {
		points, distance := simulator.GenerateRideForScenario(config, scenario.ID)
		if len(points) == 0 {
			writeError(w, http.StatusInternalServerError, "generated ride has no points")
			return
		}
		ride := models.Ride{
			Source:         "custom_scenario",
			ScenarioID:     scenario.ID,
			BikeType:       1,
			PhoneLocation:  1,
			StartedAt:      points[0].RecordedAt,
			EndedAt:        &points[len(points)-1].RecordedAt,
			DistanceMeters: distance,
		}
		created, err := a.ingestRide(r.Context(), ride, points)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)
		return
	}

	if strings.TrimSpace(a.SumoRunnerURL) == "" {
		writeError(w, http.StatusServiceUnavailable, "SUMO runner is not configured")
		return
	}

	conflict := r.URL.Query().Get("conflict")
	if conflict == "" {
		conflict = "bicycle-bicycle"
	}
	demandWindow := r.URL.Query().Get("window")
	if demandWindow == "" {
		demandWindow = "07:00-08:00"
	}

	isSync := strings.EqualFold(r.URL.Query().Get("sync"), "true") || strings.EqualFold(r.URL.Query().Get("sync"), "1")

	if isSync {
		log.Printf("SUMO sync request starting: scenario=%s conflict=%s window=%s runner=%s", scenario.ID, conflict, demandWindow, a.SumoRunnerURL)
		result, err := a.runSUMOSync(r.Context(), scenario.ID, conflict, demandWindow)
		if err != nil {
			log.Printf("SUMO sync request failed: scenario=%s conflict=%s window=%s error=%v", scenario.ID, conflict, demandWindow, err)
			writeError(w, http.StatusBadGateway, "SUMO simulation failed: "+err.Error())
			return
		}
		created, err := a.ingestSUMOResult(r.Context(), result)
		if err != nil {
			log.Printf("SUMO ingest failed: error=%v", err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)
		return
	}

	// Asynchronous job mode: starts simulation in runner and returns tracking job ID
	log.Printf("SUMO async request starting: scenario=%s conflict=%s window=%s runner=%s", scenario.ID, conflict, demandWindow, a.SumoRunnerURL)
	job, err := a.startSUMOJob(r.Context(), scenario.ID, conflict, demandWindow)
	if err != nil {
		log.Printf("SUMO start job failed: scenario=%s conflict=%s window=%s error=%v", scenario.ID, conflict, demandWindow, err)
		writeError(w, http.StatusBadGateway, "SUMO simulation failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, simulationStatusResponse{
		JobID:      job.JobID,
		Status:     job.Status,
		Step:       job.Step,
		TotalSteps: job.TotalSteps,
		Progress:   job.Progress,
	})
}

// SimulateStatus handles GET /api/simulate/status?job_id=...
func (a *App) SimulateStatus(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("job_id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "missing job_id parameter")
		return
	}

	// If already ingested and cached, return completed ride immediately
	if val, ok := a.ingestedJobs.Load(jobID); ok {
		ride := val.(models.Ride)
		writeJSON(w, http.StatusOK, simulationStatusResponse{
			JobID:    jobID,
			Status:   "completed",
			Progress: 100.0,
			Ride:     &ride,
		})
		return
	}

	job, err := a.getSUMOJob(r.Context(), jobID)
	if err != nil {
		log.Printf("SUMO status query failed for job=%s: %v", jobID, err)
		writeError(w, http.StatusBadGateway, "query SUMO runner: "+err.Error())
		return
	}

	if job.Status == "failed" {
		writeJSON(w, http.StatusOK, simulationStatusResponse{
			JobID:  jobID,
			Status: "failed",
			Error:  job.Error,
		})
		return
	}

	if job.Status == "running" {
		writeJSON(w, http.StatusOK, simulationStatusResponse{
			JobID:      jobID,
			Status:     "running",
			Step:       job.Step,
			TotalSteps: job.TotalSteps,
			Progress:   job.Progress,
		})
		return
	}

	if job.Status == "completed" {
		if job.Result == nil {
			writeError(w, http.StatusBadGateway, "simulation completed but returned no results")
			return
		}
		created, err := a.ingestSUMOResult(r.Context(), *job.Result)
		if err != nil {
			log.Printf("SUMO ingest failed for job=%s: %v", jobID, err)
			writeError(w, http.StatusInternalServerError, "ingest simulation results: "+err.Error())
			return
		}
		a.ingestedJobs.Store(jobID, created)
		writeJSON(w, http.StatusOK, simulationStatusResponse{
			JobID:    jobID,
			Status:   "completed",
			Progress: 100.0,
			Ride:     &created,
		})
		return
	}

	writeJSON(w, http.StatusOK, simulationStatusResponse{
		JobID:    jobID,
		Status:   job.Status,
		Progress: job.Progress,
	})
}

func (a *App) startSUMOJob(ctx context.Context, scenarioID, conflict, demandWindow string) (sumoJobResponse, error) {
	seed := time.Now().UnixNano() % 2147483647
	runnerURL := fmt.Sprintf("%s/simulate?async=true&scenario=%s&seed=%d&conflict=%s&window=%s",
		strings.TrimRight(a.SumoRunnerURL, "/"),
		url.QueryEscape(scenarioID),
		seed,
		url.QueryEscape(conflict),
		url.QueryEscape(demandWindow),
	)
	body, _ := json.Marshal(map[string]any{"scenario": scenarioID, "seed": seed, "conflict": conflict, "window": demandWindow})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, runnerURL, bytes.NewReader(body))
	if err != nil {
		return sumoJobResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return sumoJobResponse{}, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return sumoJobResponse{}, err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return sumoJobResponse{}, fmt.Errorf("runner returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	var job sumoJobResponse
	if err := json.Unmarshal(data, &job); err != nil {
		return sumoJobResponse{}, fmt.Errorf("unmarshal job response: %w", err)
	}
	return job, nil
}

func (a *App) getSUMOJob(ctx context.Context, jobID string) (sumoJobResponse, error) {
	runnerURL := fmt.Sprintf("%s/jobs/%s", strings.TrimRight(a.SumoRunnerURL, "/"), url.PathEscape(jobID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, runnerURL, nil)
	if err != nil {
		return sumoJobResponse{}, err
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return sumoJobResponse{}, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 128<<20))
	if err != nil {
		return sumoJobResponse{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return sumoJobResponse{}, fmt.Errorf("runner returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	log.Printf("DEBUG getSUMOJob: read %d bytes (resp.ContentLength=%d)", len(data), resp.ContentLength)
	var job sumoJobResponse
	if err := json.Unmarshal(data, &job); err != nil {
		if len(data) > 100 {
			log.Printf("DEBUG getSUMOJob tail 100 chars: %s", string(data[len(data)-100:]))
		}
		return sumoJobResponse{}, fmt.Errorf("unmarshal job status: %w", err)
	}
	return job, nil
}

func (a *App) runSUMOSync(ctx context.Context, scenarioID, conflict, demandWindow string) (sumoSimulationResponse, error) {
	seed := time.Now().UnixNano() % 2147483647
	runnerURL := fmt.Sprintf("%s/simulate?sync=true&scenario=%s&seed=%d&conflict=%s&window=%s",
		strings.TrimRight(a.SumoRunnerURL, "/"),
		url.QueryEscape(scenarioID),
		seed,
		url.QueryEscape(conflict),
		url.QueryEscape(demandWindow),
	)
	body, _ := json.Marshal(map[string]any{"scenario": scenarioID, "seed": seed, "conflict": conflict, "window": demandWindow, "sync": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, runnerURL, bytes.NewReader(body))
	if err != nil {
		return sumoSimulationResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 900 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return sumoSimulationResponse{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 128<<20))
	if err != nil {
		return sumoSimulationResponse{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return sumoSimulationResponse{}, fmt.Errorf("runner returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var result sumoSimulationResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return sumoSimulationResponse{}, fmt.Errorf("unmarshal simulation response: %w", err)
	}
	return result, nil
}

func (a *App) ingestSUMOResult(ctx context.Context, result sumoSimulationResponse) (models.Ride, error) {
	if len(result.Points) == 0 {
		return models.Ride{}, fmt.Errorf("SUMO returned no ego telemetry")
	}

	points := make([]models.RidePoint, len(result.Points))
	for i, p := range result.Points {
		points[i] = models.RidePoint{
			Seq: i, Lat: p.Lat, Lon: p.Lon,
			AccelX: p.AccelX, AccelY: p.AccelY, AccelZ: p.AccelZ,
			GyroA: p.GyroA, GyroB: p.GyroB, GyroC: p.GyroC,
			LinAccelX: p.LinAccelX, LinAccelY: p.LinAccelY, LinAccelZ: p.LinAccelZ,
			ObsDistLeftM: p.ObsDistLeftM, ObsDistRightM: p.ObsDistRightM, ObsDistSameLaneM: p.ObsDistSameLaneM,
			ScenarioID: p.ScenarioID, LaneType: p.LaneType,
			EgoAgentType: p.EgoAgentType, ConflictCategory: p.ConflictCategory,
			CounterpartID: p.CounterpartAgentID, CounterpartAgentType: p.CounterpartAgentType,
			RecordedAt: time.UnixMilli(p.TimestampMs).UTC(),
		}
	}
	distance := 0.0
	for i := 1; i < len(points); i++ {
		distance += geoDistance(points[i-1], points[i])
	}
	started := points[0].RecordedAt
	ended := points[len(points)-1].RecordedAt
	ride := models.Ride{
		Source: "sumo", ScenarioID: result.ScenarioID, BikeType: 1, PhoneLocation: 1,
		StartedAt: started, EndedAt: &ended, DistanceMeters: distance,
		Metadata: result.Metadata,
	}
	return a.ingestRide(ctx, ride, points)
}

func geoDistance(a, b models.RidePoint) float64 {
	const earth = 6371000.0
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	dLat := lat2 - lat1
	dLon := (b.Lon - a.Lon) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return earth * 2 * math.Asin(math.Sqrt(h))
}
