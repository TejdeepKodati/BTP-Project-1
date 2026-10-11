package api

import (
	"net/http"
	"time"

	"cyclesafe/internal/models"
)

const (
	cacheKeyOverview = "stats:overview"
	cacheKeyHeatmap  = "stats:heatmap"
	statsCacheTTL    = 60 * time.Second
)

func (a *App) GetOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var cached models.OverviewStats
	if hit, err := a.Cache.Get(ctx, cacheKeyOverview, &cached); err == nil && hit {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	stats, err := a.Store.Overview(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "overview: "+err.Error())
		return
	}
	_ = a.Cache.Set(ctx, cacheKeyOverview, stats, statsCacheTTL)
	writeJSON(w, http.StatusOK, stats)
}
func (a *App) GetHeatmap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var cached []models.HeatpointBucket
	if hit, err := a.Cache.Get(ctx, cacheKeyHeatmap, &cached); err == nil && hit {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	buckets, err := a.Store.Heatmap(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "heatmap: "+err.Error())
		return
	}
	if buckets == nil {
		buckets = []models.HeatpointBucket{}
	}
	_ = a.Cache.Set(ctx, cacheKeyHeatmap, buckets, statsCacheTTL)
	writeJSON(w, http.StatusOK, buckets)
}
