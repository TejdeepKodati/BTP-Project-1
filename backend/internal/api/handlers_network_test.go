package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNetworkConfigEndpointIsReadOnlyAndScenarioSelectable(t *testing.T) {
	router := NewRouter(&App{})
	req := httptest.NewRequest(http.MethodGet, "/api/network/config?scenario=bicycle-car", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Backend            string `json:"backend"`
		SelectedScenarioID string `json:"selected_scenario_id"`
		SUMOIntegrated     bool   `json:"sumo_integrated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Backend != "sumo_traci" || body.SelectedScenarioID != "bicycle-car" || !body.SUMOIntegrated {
		t.Fatalf("unexpected config selection: %#v", body)
	}

	badReq := httptest.NewRequest(http.MethodGet, "/api/network/config?scenario=does-not-exist", nil)
	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusNotFound {
		t.Fatalf("unknown scenario status = %d, want 404", badRec.Code)
	}
}
