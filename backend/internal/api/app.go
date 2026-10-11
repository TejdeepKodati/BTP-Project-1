package api

import (
	"sync"

	"cyclesafe/internal/cache"
	"cyclesafe/internal/db"
)

type App struct {
	Store          *db.Store
	Cache          *cache.Cache
	SampleRidePath string
	SumoRunnerURL  string
	ingestedJobs   sync.Map
}

func NewApp(store *db.Store, c *cache.Cache, sampleRidePath, sumoRunnerURL string) *App {
	return &App{Store: store, Cache: c, SampleRidePath: sampleRidePath, SumoRunnerURL: sumoRunnerURL}
}
