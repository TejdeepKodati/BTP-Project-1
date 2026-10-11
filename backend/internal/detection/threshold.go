package detection

import (
	"fmt"
	"math"
	"sort"

	"cyclesafe/internal/models"
)

const (
	hardBrakeMediumMS2 = 2.0
	hardBrakeHighMS2   = 3.0

	hardEventMediumMS2 = 6.0
	hardEventHighMS2   = 9.0

	sharpTurnMediumRadS = 2.5
	sharpTurnHighRadS   = 4.0

	closePassHighM   = 1.2
	closePassMediumM = 1.5

	tailgatingHighM   = 1.0
	tailgatingMediumM = 2.0

	proximityEpisodeGapS = 3.5
	dynamicEpisodeGapS   = 2.5
)

type candidateEvent struct {
	point        models.RidePoint
	incidentType string
	severity     string
	magnitude    float64
}

// Evaluate applies heuristic threshold checks with temporal/spatial grouping
// so that continuous passes or extended braking maneuvers are aggregated into
// single representative incidents at peak severity rather than generating
// duplicate events at every 0.5s simulation step.
func Evaluate(rideID string, points []models.RidePoint) []models.Incident {
	if len(points) == 0 {
		return nil
	}

	var dynCandidates []candidateEvent
	cpCandidates := make(map[string][]candidateEvent)

	for _, p := range points {
		if inc, ok := checkHardEvent(rideID, p); ok {
			dynCandidates = append(dynCandidates, candidateEvent{point: p, incidentType: inc.IncidentType, severity: inc.Severity, magnitude: inc.Magnitude})
			continue
		}
		if inc, ok := checkSharpTurn(rideID, p); ok {
			dynCandidates = append(dynCandidates, candidateEvent{point: p, incidentType: inc.IncidentType, severity: inc.Severity, magnitude: inc.Magnitude})
			continue
		}
		if inc, ok := checkClosePass(rideID, p); ok {
			key := p.CounterpartID
			if key == "" {
				key = "_anonymous_proximity_"
			}
			cpCandidates[key] = append(cpCandidates[key], candidateEvent{point: p, incidentType: inc.IncidentType, severity: inc.Severity, magnitude: inc.Magnitude})
		}
	}

	var incidents []models.Incident

	// 1. Aggregate proximity candidates for each counterpart vehicle into continuous episodes
	for _, cands := range cpCandidates {
		if len(cands) == 0 {
			continue
		}
		episode := []candidateEvent{cands[0]}
		for i := 1; i < len(cands); i++ {
			dt := cands[i].point.RecordedAt.Sub(episode[len(episode)-1].point.RecordedAt).Seconds()
			if dt <= proximityEpisodeGapS {
				episode = append(episode, cands[i])
			} else {
				incidents = append(incidents, pickBestProximityIncident(rideID, episode))
				episode = []candidateEvent{cands[i]}
			}
		}
		if len(episode) > 0 {
			incidents = append(incidents, pickBestProximityIncident(rideID, episode))
		}
	}

	// 2. Aggregate dynamic maneuvering candidates (hard brake / swerve / sharp turn)
	if len(dynCandidates) > 0 {
		episode := []candidateEvent{dynCandidates[0]}
		for i := 1; i < len(dynCandidates); i++ {
			dt := dynCandidates[i].point.RecordedAt.Sub(episode[len(episode)-1].point.RecordedAt).Seconds()
			if dt <= dynamicEpisodeGapS && dynCandidates[i].incidentType == episode[0].incidentType {
				episode = append(episode, dynCandidates[i])
			} else {
				incidents = append(incidents, pickPeakDynamicIncident(rideID, episode))
				episode = []candidateEvent{dynCandidates[i]}
			}
		}
		if len(episode) > 0 {
			incidents = append(incidents, pickPeakDynamicIncident(rideID, episode))
		}
	}

	sort.Slice(incidents, func(i, j int) bool {
		return incidents[i].DetectedAt.Before(incidents[j].DetectedAt)
	})

	return incidents
}

func pickBestProximityIncident(rideID string, episode []candidateEvent) models.Incident {
	best := episode[0]
	for _, c := range episode[1:] {
		if c.magnitude < best.magnitude {
			best = c
		}
	}
	severity := "medium"
	if best.incidentType == "tailgating" {
		if best.magnitude <= tailgatingHighM {
			severity = "high"
		}
	} else if best.magnitude < closePassHighM {
		severity = "high"
	}
	return newIncident(rideID, best.point, best.incidentType, severity, best.magnitude)
}

func pickPeakDynamicIncident(rideID string, episode []candidateEvent) models.Incident {
	best := episode[0]
	for _, c := range episode[1:] {
		if c.magnitude > best.magnitude {
			best = c
		}
	}
	return newIncident(rideID, best.point, best.incidentType, best.severity, best.magnitude)
}

func checkHardEvent(rideID string, p models.RidePoint) (models.Incident, bool) {
	// A bicycle decelerating abruptly (braking) produces negative LinAccelX
	if p.LinAccelX <= -hardBrakeHighMS2 {
		return newIncident(rideID, p, "hard_brake", "high", -p.LinAccelX), true
	}
	if p.LinAccelX <= -hardBrakeMediumMS2 {
		return newIncident(rideID, p, "hard_brake", "medium", -p.LinAccelX), true
	}
	mag := magnitude3(p.LinAccelX, p.LinAccelY, p.LinAccelZ)
	switch {
	case mag >= hardEventHighMS2:
		return newIncident(rideID, p, "hard_brake_or_swerve", "high", mag), true
	case mag >= hardEventMediumMS2:
		return newIncident(rideID, p, "hard_brake_or_swerve", "medium", mag), true
	}
	return models.Incident{}, false
}

func checkSharpTurn(rideID string, p models.RidePoint) (models.Incident, bool) {
	mag := magnitude3(p.GyroA, p.GyroB, p.GyroC)
	switch {
	case mag >= sharpTurnHighRadS:
		return newIncident(rideID, p, "sharp_turn", "high", mag), true
	case mag >= sharpTurnMediumRadS:
		return newIncident(rideID, p, "sharp_turn", "medium", mag), true
	}
	return models.Incident{}, false
}

func checkClosePass(rideID string, p models.RidePoint) (models.Incident, bool) {
	// A same-lane bicycle-bicycle proximity is better described as tailgating
	// than as a lateral close pass. SimRa distinguishes those incident types.
	if p.ObsDistSameLaneM != nil {
		return proximityIncident(rideID, p, *p.ObsDistSameLaneM, "tailgating")
	}
	best := closestOf(p.ObsDistLeftM, p.ObsDistRightM)
	if best == nil {
		return models.Incident{}, false
	}
	return proximityIncident(rideID, p, *best, "close_pass")
}

func proximityIncident(rideID string, p models.RidePoint, distance float64, kind string) (models.Incident, bool) {
	if kind == "tailgating" {
		switch {
		case distance <= tailgatingHighM:
			return newIncident(rideID, p, kind, "high", distance), true
		case distance <= tailgatingMediumM:
			return newIncident(rideID, p, kind, "medium", distance), true
		}
		return models.Incident{}, false
	}
	switch {
	case distance < closePassHighM:
		return newIncident(rideID, p, kind, "high", distance), true
	case distance < closePassMediumM:
		return newIncident(rideID, p, kind, "medium", distance), true
	}
	return models.Incident{}, false
}

func newIncident(rideID string, p models.RidePoint, kind, severity string, magnitude float64) models.Incident {
	var evidence string
	switch kind {
	case "close_pass":
		evidence = fmt.Sprintf("Lateral passing clearance %.2f m is below the 1.50 m German StVO passing threshold", magnitude)
	case "tailgating":
		evidence = fmt.Sprintf("Same-lane longitudinal gap %.2f m is within dangerous following threshold", magnitude)
	case "hard_brake":
		evidence = fmt.Sprintf("Longitudinal deceleration %.2f m/s² indicates emergency braking maneuver", magnitude)
	case "hard_brake_or_swerve":
		evidence = fmt.Sprintf("Dynamic acceleration magnitude %.2f m/s² indicates abrupt swerve or hard braking", magnitude)
	case "sharp_turn":
		evidence = fmt.Sprintf("Angular rate %.2f rad/s exceeds stable turning threshold", magnitude)
	default:
		evidence = fmt.Sprintf("Detected %s event with magnitude %.2f", kind, magnitude)
	}

	return models.Incident{
		RideID:               rideID,
		PointID:              p.ID,
		IncidentType:         kind,
		Severity:             severity,
		Magnitude:            magnitude,
		Lat:                  p.Lat,
		Lon:                  p.Lon,
		DetectedAt:           p.RecordedAt,
		ScenarioID:           p.ScenarioID,
		LaneType:             p.LaneType,
		ConflictCategory:     p.ConflictCategory,
		CounterpartID:        p.CounterpartID,
		CounterpartAgentType: p.CounterpartAgentType,
		Evidence:             evidence,
	}
}

func magnitude3(x, y, z float64) float64 {
	return math.Sqrt(x*x + y*y + z*z)
}

func closestOf(a, b *float64) *float64 {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if *a < *b {
		return a
	}
	return b
}
