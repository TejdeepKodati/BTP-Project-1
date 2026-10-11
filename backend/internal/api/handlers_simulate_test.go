package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSumoSimulationResponseUnmarshalsNestedMetadataObject(t *testing.T) {
	// Verifies that metadata containing a JSON object (such as runner.py's "demand" dictionary)
	// unmarshals cleanly without error into Metadata map[string]any.
	sampleJSON := []byte(`{
		"source": "sumo",
		"scenario_id": "berlin-multi-traffic",
		"lane_type": "mixed + bicycle-only",
		"conflict_category": "bicycle-bicycle",
		"ego_agent_type": "bicycle",
		"counterpart_agent_type": "multiple",
		"points": [
			{
				"seq": 0,
				"lat": 52.4885,
				"lon": 13.3895,
				"accel_x": 0.0,
				"accel_y": 0.0,
				"accel_z": 9.81,
				"gyro_a": 0.0,
				"gyro_b": 0.0,
				"gyro_c": 0.0,
				"lin_accel_x": 0.0,
				"lin_accel_y": 0.0,
				"lin_accel_z": 0.0,
				"obs_dist_left_m": null,
				"obs_dist_right_m": null,
				"obs_dist_same_lane_m": null,
				"timestamp_ms": 1728573436000,
				"scenario_id": "berlin-multi-traffic",
				"lane_type": "mixed + bicycle-only",
				"ego_agent_type": "bicycle",
				"conflict_category": "multi-traffic",
				"counterpart_agent_id": "",
				"counterpart_agent_type": ""
			}
		],
		"metadata": {
			"engine": "Eclipse SUMO 1.27.1",
			"demand": {
				"ego_id": "ego_bicycle",
				"bicycles": 116,
				"cars": 1036,
				"motorbikes": 56,
				"trucks": 34,
				"kfz_total": 1128
			},
			"selected_conflict": "bicycle-bicycle",
			"demand_window": "07:00-08:00"
		}
	}`)

	var resp sumoSimulationResponse
	if err := json.Unmarshal(sampleJSON, &resp); err != nil {
		t.Fatalf("expected successful unmarshal with nested metadata, got: %v", err)
	}

	if resp.Source != "sumo" || resp.ScenarioID != "berlin-multi-traffic" {
		t.Fatalf("unexpected response header: %#v", resp)
	}
	if len(resp.Points) != 1 {
		t.Fatalf("points count = %d, want 1", len(resp.Points))
	}
	demandMap, ok := resp.Metadata["demand"].(map[string]any)
	if !ok {
		t.Fatalf("metadata.demand is not a map: %#v", resp.Metadata["demand"])
	}
	if demandMap["bicycles"].(float64) != 116 {
		t.Fatalf("bicycles demand = %v, want 116", demandMap["bicycles"])
	}
}

func TestSimulateStatusRequiresJobID(t *testing.T) {
	app := &App{}
	router := NewRouter(app)
	req := httptest.NewRequest(http.MethodGet, "/api/simulate/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when job_id missing", rec.Code)
	}
}

func TestSimulateAsyncJobFlow(t *testing.T) {
	// Mock runner server
	mockRunner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/simulate":
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(sumoJobResponse{
				JobID:      "job-test-123",
				Status:     "running",
				Step:       100,
				TotalSteps: 7201,
				Progress:   1.4,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/jobs/job-test-123":
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(sumoJobResponse{
				JobID:      "job-test-123",
				Status:     "running",
				Step:       3600,
				TotalSteps: 7201,
				Progress:   50.0,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockRunner.Close()

	app := &App{SumoRunnerURL: mockRunner.URL}
	router := NewRouter(app)

	// 1. POST /api/simulate -> returns 202 with job_id
	postReq := httptest.NewRequest(http.MethodPost, "/api/simulate?scenario=berlin-multi-traffic", nil)
	postRec := httptest.NewRecorder()
	router.ServeHTTP(postRec, postReq)

	if postRec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202: %s", postRec.Code, postRec.Body.String())
	}
	var startResp simulationStatusResponse
	if err := json.Unmarshal(postRec.Body.Bytes(), &startResp); err != nil {
		t.Fatalf("unmarshal start response: %v", err)
	}
	if startResp.JobID != "job-test-123" || startResp.Status != "running" {
		t.Fatalf("unexpected start response: %#v", startResp)
	}

	// 2. GET /api/simulate/status?job_id=job-test-123 -> returns 200 with progress
	statusReq := httptest.NewRequest(http.MethodGet, "/api/simulate/status?job_id=job-test-123", nil)
	statusRec := httptest.NewRecorder()
	router.ServeHTTP(statusRec, statusReq)

	if statusRec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", statusRec.Code, statusRec.Body.String())
	}
	var statusResp simulationStatusResponse
	if err := json.Unmarshal(statusRec.Body.Bytes(), &statusResp); err != nil {
		t.Fatalf("unmarshal status response: %v", err)
	}
	if statusResp.Status != "running" || statusResp.Progress != 50.0 || statusResp.Step != 3600 {
		t.Fatalf("unexpected status response: %#v", statusResp)
	}
}

