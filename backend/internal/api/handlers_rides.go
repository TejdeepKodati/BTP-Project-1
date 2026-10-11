package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"cyclesafe/internal/detection"
	"cyclesafe/internal/geo"
	"cyclesafe/internal/models"
)

func (a *App) CreateRide(w http.ResponseWriter, r *http.Request) {
	var req models.IngestRideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if len(req.Points) == 0 {
		writeError(w, http.StatusBadRequest, "points must not be empty")
		return
	}
	if req.Source == "" {
		req.Source = "device"
	}

	points := make([]models.RidePoint, len(req.Points))
	for i, ip := range req.Points {
		points[i] = models.RidePoint{
			Seq:              i,
			Lat:              ip.Lat,
			Lon:              ip.Lon,
			AccelX:           ip.AccelX,
			AccelY:           ip.AccelY,
			AccelZ:           ip.AccelZ,
			GyroA:            ip.GyroA,
			GyroB:            ip.GyroB,
			GyroC:            ip.GyroC,
			LinAccelX:        ip.LinAccelX,
			LinAccelY:        ip.LinAccelY,
			LinAccelZ:        ip.LinAccelZ,
			ObsDistLeftM:     ip.ObsDistLeftM,
			ObsDistRightM:    ip.ObsDistRightM,
			ObsDistSameLaneM: ip.ObsDistSameLaneM,
			RecordedAt:       time.UnixMilli(ip.TimestampMs).UTC(),
		}
	}

	distance := 0.0
	for i := 1; i < len(points); i++ {
		distance += geo.HaversineM(points[i-1].Lat, points[i-1].Lon, points[i].Lat, points[i].Lon)
	}

	ride := models.Ride{
		Source:         req.Source,
		BikeType:       req.BikeType,
		PhoneLocation:  req.PhoneLocation,
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
}

func (a *App) ingestRide(ctx context.Context, ride models.Ride, points []models.RidePoint) (models.Ride, error) {
	rideID, err := a.Store.CreateRide(ctx, ride)
	if err != nil {
		return models.Ride{}, fmt.Errorf("create ride: %w", err)
	}

	storedPoints, err := a.Store.InsertPoints(ctx, rideID, points)
	if err != nil {
		return models.Ride{}, fmt.Errorf("store points: %w", err)
	}

	incidents := detection.Evaluate(rideID, storedPoints)
	if err := a.Store.InsertIncidents(ctx, incidents); err != nil {
		return models.Ride{}, fmt.Errorf("store incidents: %w", err)
	}

	// A new ride changes the fleet-wide totals and the incident heatmap,
	a.Cache.InvalidatePrefix(ctx, cacheKeyOverview)
	a.Cache.InvalidatePrefix(ctx, cacheKeyHeatmap)

	return a.Store.GetRide(ctx, rideID)
}

// ListRides handles GET /api/rides.
func (a *App) ListRides(w http.ResponseWriter, r *http.Request) {
	rides, err := a.Store.ListRides(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list rides: "+err.Error())
		return
	}
	if rides == nil {
		rides = []models.Ride{}
	}
	writeJSON(w, http.StatusOK, rides)
}

// GetRide handles GET /api/rides/{id}.
func (a *App) GetRide(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ride, err := a.Store.GetRide(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ride not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get ride: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ride)
}

func (a *App) GetRidePoints(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	points, err := a.Store.ListPoints(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list points: "+err.Error())
		return
	}
	if points == nil {
		points = []models.RidePoint{}
	}
	writeJSON(w, http.StatusOK, points)
}

// GetRideIncidents handles GET /api/rides/{id}/incidents.
func (a *App) GetRideIncidents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	incidents, err := a.Store.ListIncidents(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list incidents: "+err.Error())
		return
	}
	if incidents == nil {
		incidents = []models.Incident{}
	}
	writeJSON(w, http.StatusOK, incidents)
}

func (a *App) GetRideInteractions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	items, err := a.Store.RideInteractions(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list interactions: "+err.Error())
		return
	}
	if items == nil {
		items = []models.RideInteraction{}
	}
	writeJSON(w, http.StatusOK, items)
}

// ResetDashboard clears all persisted ride, point and incident data.
func (a *App) ResetDashboard(w http.ResponseWriter, r *http.Request) {
	if err := a.Store.ResetTelemetry(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "reset dashboard: "+err.Error())
		return
	}
	a.Cache.InvalidatePrefix(r.Context(), cacheKeyOverview)
	a.Cache.InvalidatePrefix(r.Context(), cacheKeyHeatmap)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":            "reset",
		"total_rides":       0,
		"total_distance_km": 0,
		"total_incidents":   0,
		"safety_score":      100,
	})
}
