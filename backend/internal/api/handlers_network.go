package api

import (
	"net/http"

	"cyclesafe/internal/network"
)

// GetNetworkConfig is a read-only view of the selected SUMO road-network scenario. The
// optional scenario query parameter only selects the response; it does not
// mutate server state. Example: GET /api/network/config?scenario=bicycle-car.
func (a *App) GetNetworkConfig(w http.ResponseWriter, r *http.Request) {
	config := network.Load()
	scenarioID := r.URL.Query().Get("scenario")
	if scenarioID == "" {
		scenarioID = r.URL.Query().Get("scenario_id")
	}
	if scenarioID == "" {
		scenarioID = config.DefaultScenarioID
	}
	if _, err := config.SelectScenario(scenarioID); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	config.SelectedScenarioID = scenarioID
	writeJSON(w, http.StatusOK, config)
}
