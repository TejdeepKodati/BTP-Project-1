package simulator

import (
	"reflect"
	"testing"

	"cyclesafe/internal/network"
)

func TestGenerateRideForScenarioIsDeterministicAndLabeled(t *testing.T) {
	c := network.Load()
	a, distanceA := GenerateRideForScenario(c, "bicycle-car")
	b, distanceB := GenerateRideForScenario(c, "bicycle-car")
	if len(a) != 121 || len(b) != len(a) {
		t.Fatalf("point counts = %d/%d, want 121", len(a), len(b))
	}
	if distanceA != distanceB || !reflect.DeepEqual(a, b) {
		t.Fatal("same scenario did not produce identical points and distance")
	}
	for _, point := range a {
		if point.ScenarioID != "bicycle-car" || point.LaneType != "mixed" || point.EgoAgentType != "bicycle" {
			t.Fatalf("point missing scenario labels: %#v", point)
		}
	}
	if a[35].ConflictCategory != "bicycle-car" || a[80].ConflictCategory != "bicycle-car" {
		t.Fatalf("scripted event labels = %q/%q", a[35].ConflictCategory, a[80].ConflictCategory)
	}
	if a[35].ObsDistLeftM == nil {
		t.Fatal("close-pass event did not generate proximity data")
	}

	other, _ := GenerateRideForScenario(c, "bicycle-bicycle")
	if reflect.DeepEqual(a, other) {
		t.Fatal("different selected scenario produced identical telemetry")
	}
}
