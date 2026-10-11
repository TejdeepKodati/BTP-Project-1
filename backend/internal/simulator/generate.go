package simulator

import (
	"math"
	"math/rand"
	"time"

	"cyclesafe/internal/models"
	"cyclesafe/internal/network"
)

// GenerateRide uses the default configured German scenario. Keeping this
// wrapper preserves the simulator's original package API for callers that do
// not need scenario selection.
func GenerateRide() ([]models.RidePoint, float64) {
	return GenerateRideForScenario(network.Load(), network.Load().DefaultScenarioID)
}

// GenerateRideForScenario is retained for legacy unit tests and local
// comparison. It is not used by the production road-network simulation path.
func GenerateRideForScenario(config network.Config, scenarioID string) ([]models.RidePoint, float64) {
	scenario, err := config.SelectScenario(scenarioID)
	if err != nil {
		return nil, 0
	}

	rng := rand.New(rand.NewSource(scenario.Seed))
	nPoints := scenario.SampleCount
	if nPoints < 1 {
		return nil, 0
	}
	startTime := time.Date(2025, 4, 3, 7, 0, 0, 0, time.UTC)
	if scenario.StartTime != "" {
		if parsed, err := time.Parse(time.RFC3339, scenario.StartTime); err == nil {
			startTime = parsed
		}
	}
	interval := time.Duration(scenario.SampleIntervalS * float64(time.Second))
	if interval <= 0 {
		return nil, 0
	}

	// The route is deliberately a short, straight illustrative corridor. Its
	// lane and interaction labels come from the selected scenario data rather
	// than from an implicit hard-coded vehicle model.
	if len(scenario.RouteLaneIDs) == 0 {
		return nil, 0
	}
	configLane, edge, ok := config.FindLane(scenario.RouteLaneIDs[0])
	if !ok {
		return nil, 0
	}
	from, fromOK := config.FindNode(edge.From)
	to, toOK := config.FindNode(edge.To)
	if !fromOK || !toOK {
		return nil, 0
	}
	lat, lon := from.Lat, from.Lon
	// Heading follows the configured directed edge. Coordinates are WGS84;
	// scaling longitude by cos(latitude) keeps this adequate for the small
	// illustrative corridor.
	heading := math.Atan2((to.Lon-from.Lon)*math.Cos(from.Lat*math.Pi/180), to.Lat-from.Lat)

	events := make(map[int]network.ScriptEvent, len(scenario.Events))
	for _, event := range scenario.Events {
		events[event.Seq] = event
	}
	points := make([]models.RidePoint, 0, nPoints)
	for seq := 0; seq < nPoints; seq++ {
		heading += (rng.Float64() - 0.5) * 0.012
		speed := scenario.BicycleSpeedMS + (rng.Float64()-0.5)*0.25
		linY := (rng.Float64() - 0.5) * 0.4
		gyroC := (rng.Float64() - 0.5) * 0.12
		var obsLeft *float64

		if event, ok := events[seq]; ok {
			linY = event.LinAccelY
			gyroC = event.GyroC
			if event.ClearanceLeftM != nil {
				clearance := *event.ClearanceLeftM
				obsLeft = &clearance
			}
		}

		dlat := (speed * math.Cos(heading)) / 111320.0
		dlon := (speed * math.Sin(heading)) / (111320.0 * math.Cos(lat*math.Pi/180))
		lat += dlat
		lon += dlon

		conflict := ""
		if _, ok := events[seq]; ok {
			conflict = scenario.ConflictCategory
		}
		points = append(points, models.RidePoint{
			Seq:              seq,
			Lat:              lat,
			Lon:              lon,
			AccelX:           (rng.Float64() - 0.5) * 1.2,
			AccelY:           (rng.Float64() - 0.5) * 1.2,
			AccelZ:           9.81 + (rng.Float64()-0.5)*0.8,
			GyroA:            (rng.Float64() - 0.5) * 0.3,
			GyroB:            (rng.Float64() - 0.5) * 0.3,
			GyroC:            gyroC,
			LinAccelX:        (rng.Float64() - 0.5) * 0.8,
			LinAccelY:        linY,
			LinAccelZ:        (rng.Float64() - 0.5) * 0.6,
			ObsDistLeftM:     obsLeft,
			ScenarioID:       scenario.ID,
			LaneType:         configLane.Type,
			EgoAgentType:     "bicycle",
			ConflictCategory: conflict,
			RecordedAt:       startTime.Add(time.Duration(seq) * interval),
		})
	}

	return points, totalDistanceMeters(points)
}
