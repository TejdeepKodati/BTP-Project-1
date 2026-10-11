package api

import "net/http"

func NewRouter(app *App) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "build": "cyclesafe-berlin-study-v7"})
	})

	mux.HandleFunc("POST /api/rides", app.CreateRide)
	mux.HandleFunc("GET /api/rides", app.ListRides)
	mux.HandleFunc("GET /api/rides/{id}", app.GetRide)
	mux.HandleFunc("GET /api/rides/{id}/points", app.GetRidePoints)
	mux.HandleFunc("GET /api/rides/{id}/incidents", app.GetRideIncidents)
	mux.HandleFunc("GET /api/rides/{id}/interactions", app.GetRideInteractions)

	mux.HandleFunc("POST /api/simulate", app.Simulate)
	mux.HandleFunc("GET /api/simulate/status", app.SimulateStatus)
	mux.HandleFunc("GET /api/network/config", app.GetNetworkConfig)

	mux.HandleFunc("GET /api/stats/overview", app.GetOverview)
	mux.HandleFunc("GET /api/stats/heatmap", app.GetHeatmap)
	mux.HandleFunc("POST /api/reset", app.ResetDashboard)

	return withLogging(withCORS(mux))
}
