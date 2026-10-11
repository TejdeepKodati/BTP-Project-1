package network

import "testing"

func TestGermanScenarioConfigIsExplicitAndDefensive(t *testing.T) {
	c := Load()
	if c.Backend != Backend {
		t.Fatalf("backend = %q, want %q", c.Backend, Backend)
	}
	if !c.SUMOIntegrated {
		t.Fatal("configuration must declare SUMO integration")
	}
	if c.CountryCode != "DE" || c.TrafficSide != "right" {
		t.Fatalf("country/traffic side = %s/%s", c.CountryCode, c.TrafficSide)
	}

	lanes := map[string]LaneType{}
	for _, lane := range c.LaneTypes {
		lanes[lane.ID] = lane
	}
	if got := lanes["bicycle-only"].AllowedAgents; len(got) != 1 || got[0] != "bicycle" {
		t.Fatalf("bicycle-only allowed agents = %#v", got)
	}
	if got := lanes["mixed"].AllowedAgents; len(got) != 4 {
		t.Fatalf("mixed allowed agents = %#v", got)
	}

	want := map[string]string{
		"bicycle-bicycle":    "bicycle-only",
		"bicycle-car":        "mixed",
		"bicycle-motorbike":  "mixed",
		"bicycle-heavy-duty": "mixed",
	}
	for _, conflict := range c.ConflictCategories {
		if want[conflict.ID] != conflict.LaneType {
			t.Errorf("conflict %q lane = %q, want %q", conflict.ID, conflict.LaneType, want[conflict.ID])
		}
		delete(want, conflict.ID)
	}
	if len(want) != 0 {
		t.Fatalf("missing conflict categories: %#v", want)
	}
}

func TestScenarioSelectionDoesNotMutateConfig(t *testing.T) {
	c := Load()
	if _, err := c.SelectScenario("bicycle-car"); err != nil {
		t.Fatal(err)
	}
	if c.SelectedScenarioID != c.DefaultScenarioID {
		t.Fatalf("selection mutated config: %q", c.SelectedScenarioID)
	}
	if _, err := c.SelectScenario("unknown"); err == nil {
		t.Fatal("unknown scenario unexpectedly accepted")
	}
}
