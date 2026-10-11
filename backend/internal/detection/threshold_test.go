package detection

import (
	"testing"
	"time"

	"cyclesafe/internal/models"
)

func TestEvaluateCarriesCustomScenarioEventLabels(t *testing.T) {
	incidents := Evaluate("ride-1", []models.RidePoint{{
		ID:               7,
		Lat:              52.48,
		Lon:              13.39,
		LinAccelY:        -6.5,
		ScenarioID:       "bicycle-car",
		LaneType:         "mixed",
		ConflictCategory: "bicycle-car",
		RecordedAt:       time.Unix(0, 0).UTC(),
	}})
	if len(incidents) != 1 {
		t.Fatalf("incidents = %d, want 1", len(incidents))
	}
	got := incidents[0]
	if got.ScenarioID != "bicycle-car" || got.LaneType != "mixed" || got.ConflictCategory != "bicycle-car" {
		t.Fatalf("scenario metadata not carried to event: %#v", got)
	}
}

func TestEvaluateSameLaneGapAsTailgating(t *testing.T) {
	d := 1.0
	incidents := Evaluate("ride-2", []models.RidePoint{{
		ID:               8,
		ObsDistSameLaneM: &d,
		ScenarioID:       "bicycle-bicycle",
		LaneType:         "bicycle-only",
		ConflictCategory: "bicycle-bicycle",
		RecordedAt:       time.Unix(0, 0).UTC(),
	}})
	if len(incidents) != 1 {
		t.Fatalf("incidents = %d, want 1", len(incidents))
	}
	if incidents[0].IncidentType != "tailgating" || incidents[0].Severity != "high" {
		t.Fatalf("incident = %#v, want high tailgating", incidents[0])
	}
}

func TestEvaluateAggregatesContinuousOvertakeIntoSingleIncident(t *testing.T) {
	// A single passing maneuver spanning 8 consecutive 0.5s steps with varying clearance
	// should produce exactly ONE aggregated incident, with minimum clearance as magnitude.
	clearances := []float64{1.9, 1.7, 1.4, 1.15, 1.25, 1.5, 1.8, 1.95}
	points := make([]models.RidePoint, len(clearances))
	baseTime := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	for i, c := range clearances {
		val := c
		points[i] = models.RidePoint{
			ID:                   int64(100 + i),
			Lat:                  52.4885,
			Lon:                  13.3895 + float64(i)*0.0001,
			ObsDistLeftM:         &val,
			ScenarioID:           "berlin-multi-traffic",
			LaneType:             "mixed",
			ConflictCategory:     "bicycle-car",
			CounterpartID:        "car_0042",
			CounterpartAgentType: "car",
			RecordedAt:           baseTime.Add(time.Duration(i*500) * time.Millisecond),
		}
	}

	incidents := Evaluate("ride-multi", points)
	if len(incidents) != 1 {
		t.Fatalf("incidents = %d, want 1 aggregated incident", len(incidents))
	}
	inc := incidents[0]
	if inc.CounterpartID != "car_0042" {
		t.Fatalf("counterpart = %q, want car_0042", inc.CounterpartID)
	}
	if inc.Severity != "high" {
		t.Fatalf("severity = %q, want high (since min clearance was 1.15 m)", inc.Severity)
	}
	if inc.Magnitude != 1.15 {
		t.Fatalf("magnitude = %f, want 1.15", inc.Magnitude)
	}
	if inc.PointID != 103 { // index 3 corresponds to 1.15
		t.Fatalf("pointID = %d, want 103 (sample of closest approach)", inc.PointID)
	}
}

