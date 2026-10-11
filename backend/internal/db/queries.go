package db

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"cyclesafe/internal/models"
)

// CreateRide inserts the ride header row and returns the generated ID.
func (s *Store) CreateRide(ctx context.Context, r models.Ride) (string, error) {
	metaJSON, _ := json.Marshal(r.Metadata)
	if len(metaJSON) == 0 || string(metaJSON) == "null" {
		metaJSON = []byte("{}")
	}
	const q = `
		INSERT INTO rides (source, scenario_id, bike_type, phone_location, started_at, ended_at, distance_m, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id`
	var id string
	err := s.DB.QueryRowContext(ctx, q, r.Source, r.ScenarioID, r.BikeType, r.PhoneLocation, r.StartedAt, r.EndedAt, r.DistanceMeters, metaJSON).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert ride: %w", err)
	}
	return id, nil
}
func (s *Store) ListRides(ctx context.Context) ([]models.Ride, error) {
	const q = `
		SELECT r.id, r.source, COALESCE(r.scenario_id, ''), r.bike_type, r.phone_location, r.started_at, r.ended_at,
		       r.distance_m, r.created_at, COALESCE(r.metadata, '{}'::jsonb),
		       (SELECT count(*) FROM ride_points p WHERE p.ride_id = r.id) AS point_count,
		       (SELECT count(*) FROM incidents i WHERE i.ride_id = r.id) AS incident_count
		FROM rides r
		ORDER BY r.started_at DESC`
	rows, err := s.DB.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list rides: %w", err)
	}
	defer rows.Close()

	var out []models.Ride
	for rows.Next() {
		var r models.Ride
		var metaRaw []byte
		if err := rows.Scan(&r.ID, &r.Source, &r.ScenarioID, &r.BikeType, &r.PhoneLocation, &r.StartedAt, &r.EndedAt,
			&r.DistanceMeters, &r.CreatedAt, &metaRaw, &r.PointCount, &r.IncidentCount); err != nil {
			return nil, fmt.Errorf("scan ride: %w", err)
		}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &r.Metadata)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetRide(ctx context.Context, id string) (models.Ride, error) {
	const q = `
		SELECT r.id, r.source, COALESCE(r.scenario_id, ''), r.bike_type, r.phone_location, r.started_at, r.ended_at,
		       r.distance_m, r.created_at, COALESCE(r.metadata, '{}'::jsonb),
		       (SELECT count(*) FROM ride_points p WHERE p.ride_id = r.id) AS point_count,
		       (SELECT count(*) FROM incidents i WHERE i.ride_id = r.id) AS incident_count
		FROM rides r WHERE r.id = $1`
	var r models.Ride
	var metaRaw []byte
	err := s.DB.QueryRowContext(ctx, q, id).Scan(&r.ID, &r.Source, &r.ScenarioID, &r.BikeType, &r.PhoneLocation,
		&r.StartedAt, &r.EndedAt, &r.DistanceMeters, &r.CreatedAt, &metaRaw, &r.PointCount, &r.IncidentCount)
	if err != nil {
		return r, err
	}
	if len(metaRaw) > 0 {
		_ = json.Unmarshal(metaRaw, &r.Metadata)
	}
	return r, nil
}

func (s *Store) InsertPoints(ctx context.Context, rideID string, points []models.RidePoint) ([]models.RidePoint, error) {
	if len(points) == 0 {
		return nil, nil
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	const stmt = `
		INSERT INTO ride_points
			(ride_id, seq, lat, lon, accel_x, accel_y, accel_z, gyro_a, gyro_b, gyro_c,
			 lin_accel_x, lin_accel_y, lin_accel_z, obs_dist_left_m, obs_dist_right_m, obs_dist_same_lane_m,
			 scenario_id, lane_type, ego_agent_type, conflict_category, counterpart_id, counterpart_agent_type, recorded_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		RETURNING id`
	prepared, err := tx.PrepareContext(ctx, stmt)
	if err != nil {
		return nil, fmt.Errorf("prepare insert ride_points: %w", err)
	}
	defer prepared.Close()

	out := make([]models.RidePoint, len(points))
	for i, p := range points {
		p.RideID = rideID
		if err := prepared.QueryRowContext(ctx, rideID, p.Seq, p.Lat, p.Lon, p.AccelX, p.AccelY, p.AccelZ,
			p.GyroA, p.GyroB, p.GyroC, p.LinAccelX, p.LinAccelY, p.LinAccelZ,
			p.ObsDistLeftM, p.ObsDistRightM, p.ObsDistSameLaneM, p.ScenarioID, p.LaneType, p.EgoAgentType,
			p.ConflictCategory, p.CounterpartID, p.CounterpartAgentType, p.RecordedAt).Scan(&p.ID); err != nil {
			return nil, fmt.Errorf("insert ride_point seq=%d: %w", p.Seq, err)
		}
		out[i] = p
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit ride_points: %w", err)
	}
	return out, nil
}

func (s *Store) ListPoints(ctx context.Context, rideID string) ([]models.RidePoint, error) {
	const q = `
		SELECT id, ride_id, seq, lat, lon, accel_x, accel_y, accel_z, gyro_a, gyro_b, gyro_c,
		       lin_accel_x, lin_accel_y, lin_accel_z, obs_dist_left_m, obs_dist_right_m, obs_dist_same_lane_m,
		       COALESCE(scenario_id, ''), COALESCE(lane_type, ''), COALESCE(ego_agent_type, ''),
		       COALESCE(conflict_category, ''), COALESCE(counterpart_id, ''), COALESCE(counterpart_agent_type, ''), recorded_at
		FROM ride_points WHERE ride_id = $1 ORDER BY seq ASC`
	rows, err := s.DB.QueryContext(ctx, q, rideID)
	if err != nil {
		return nil, fmt.Errorf("list points: %w", err)
	}
	defer rows.Close()

	var out []models.RidePoint
	for rows.Next() {
		var p models.RidePoint
		if err := rows.Scan(&p.ID, &p.RideID, &p.Seq, &p.Lat, &p.Lon, &p.AccelX, &p.AccelY, &p.AccelZ,
			&p.GyroA, &p.GyroB, &p.GyroC, &p.LinAccelX, &p.LinAccelY, &p.LinAccelZ,
			&p.ObsDistLeftM, &p.ObsDistRightM, &p.ObsDistSameLaneM, &p.ScenarioID, &p.LaneType, &p.EgoAgentType,
			&p.ConflictCategory, &p.CounterpartID, &p.CounterpartAgentType, &p.RecordedAt); err != nil {
			return nil, fmt.Errorf("scan point: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) InsertIncidents(ctx context.Context, incidents []models.Incident) error {
	if len(incidents) == 0 {
		return nil
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	const stmt = `
		INSERT INTO incidents (ride_id, point_id, incident_type, severity, magnitude, lat, lon, detected_at,
			scenario_id, lane_type, conflict_category, counterpart_id, counterpart_agent_type, evidence)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
	prepared, err := tx.PrepareContext(ctx, stmt)
	if err != nil {
		return fmt.Errorf("prepare insert incidents: %w", err)
	}
	defer prepared.Close()

	for _, inc := range incidents {
		if _, err := prepared.ExecContext(ctx, inc.RideID, inc.PointID, inc.IncidentType, inc.Severity,
			inc.Magnitude, inc.Lat, inc.Lon, inc.DetectedAt, inc.ScenarioID, inc.LaneType,
			inc.ConflictCategory, inc.CounterpartID, inc.CounterpartAgentType, inc.Evidence); err != nil {
			return fmt.Errorf("insert incident: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit incidents: %w", err)
	}
	return nil
}

func (s *Store) ListIncidents(ctx context.Context, rideID string) ([]models.Incident, error) {
	const q = `
		SELECT id, ride_id, point_id, incident_type, severity, magnitude, lat, lon, detected_at,
		       COALESCE(scenario_id, ''), COALESCE(lane_type, ''), COALESCE(conflict_category, ''),
		       COALESCE(counterpart_id, ''), COALESCE(counterpart_agent_type, ''),
		       COALESCE(evidence, '')
		FROM incidents WHERE ride_id = $1
		ORDER BY magnitude DESC`
	rows, err := s.DB.QueryContext(ctx, q, rideID)
	if err != nil {
		return nil, fmt.Errorf("list incidents: %w", err)
	}
	defer rows.Close()

	var out []models.Incident
	for rows.Next() {
		var inc models.Incident
		if err := rows.Scan(&inc.ID, &inc.RideID, &inc.PointID, &inc.IncidentType, &inc.Severity,
			&inc.Magnitude, &inc.Lat, &inc.Lon, &inc.DetectedAt, &inc.ScenarioID, &inc.LaneType,
			&inc.ConflictCategory, &inc.CounterpartID, &inc.CounterpartAgentType, &inc.Evidence); err != nil {
			return nil, fmt.Errorf("scan incident: %w", err)
		}
		out = append(out, inc)
	}
	return out, rows.Err()
}

func (s *Store) RideInteractions(ctx context.Context, rideID string) ([]models.RideInteraction, error) {
	const q = `
		SELECT COALESCE(p.counterpart_id, ''), COALESCE(p.counterpart_agent_type, ''),
		       COALESCE(p.ego_agent_type, 'bicycle'), COALESCE(p.conflict_category, ''),
		       count(DISTINCT p.id), count(DISTINCT i.id),
		       COALESCE(min(i.magnitude) FILTER (WHERE i.incident_type IN ('close_pass','tailgating')), 999),
		       COALESCE(count(*) FILTER (WHERE i.severity = 'high'),0),
		       COALESCE(count(*) FILTER (WHERE i.severity = 'medium'),0),
		       COALESCE(count(*) FILTER (WHERE i.severity = 'low'),0),
		       COALESCE(min(i.lat), min(p.lat)), COALESCE(min(i.lon), min(p.lon))
		FROM ride_points p
		LEFT JOIN incidents i ON i.ride_id = p.ride_id AND i.point_id = p.id
		WHERE p.ride_id = $1 AND p.counterpart_id <> ''
		GROUP BY p.counterpart_id, p.counterpart_agent_type, p.ego_agent_type, p.conflict_category
		ORDER BY p.counterpart_id`
	rows, err := s.DB.QueryContext(ctx, q, rideID)
	if err != nil {
		return nil, fmt.Errorf("ride interactions: %w", err)
	}
	defer rows.Close()
	var out []models.RideInteraction
	for rows.Next() {
		var x models.RideInteraction
		if err := rows.Scan(&x.CounterpartID, &x.CounterpartAgentType, &x.EgoAgentType, &x.ConflictCategory, &x.SampleCount, &x.IncidentCount, &x.MinDistanceM, &x.HighCount, &x.MediumCount, &x.LowCount, &x.Lat, &x.Lon); err != nil {
			return nil, fmt.Errorf("scan interaction: %w", err)
		}
		x.Status = "no interaction"
		if x.IncidentCount > 0 {
			x.Status = "safe pass"
			if x.HighCount > 0 {
				x.Status = "severe"
			} else if x.MediumCount > 0 {
				x.Status = "close pass"
			}
		}
		out = append(out, x)
	}

	// Enrich interactions with encounter timeline samples from ride metadata if present
	var metaRaw []byte
	_ = s.DB.QueryRowContext(ctx, `SELECT COALESCE(metadata, '{}'::jsonb) FROM rides WHERE id = $1`, rideID).Scan(&metaRaw)
	if len(metaRaw) > 0 {
		var meta map[string]any
		if err := json.Unmarshal(metaRaw, &meta); err == nil {
			if encRaw, ok := meta["encounters"].(map[string]any); ok {
				for i := range out {
					cid := out[i].CounterpartID
					if item, exists := encRaw[cid]; exists {
						if itemMap, isMap := item.(map[string]any); isMap {
							if samplesRaw, hasSamples := itemMap["samples"].([]any); hasSamples {
								var samples []models.EncounterSample
								sBytes, _ := json.Marshal(samplesRaw)
								_ = json.Unmarshal(sBytes, &samples)
								out[i].Samples = samples
							}
							if minD, ok := itemMap["min_distance_m"].(float64); ok && out[i].MinDistanceM >= 900 {
								out[i].MinDistanceM = minD
							}
							if st, ok := itemMap["status"].(string); ok && out[i].Status == "no interaction" && st != "" {
								out[i].Status = st
							}
						}
					}
				}
			}
		}
	}

	return out, rows.Err()
}

func (s *Store) Overview(ctx context.Context) (models.OverviewStats, error) {
	var out models.OverviewStats
	var distanceM float64
	err := s.DB.QueryRowContext(ctx, `SELECT count(*), COALESCE(sum(distance_m),0) FROM rides`).
		Scan(&out.TotalRides, &distanceM)
	if err != nil {
		return out, fmt.Errorf("overview rides: %w", err)
	}
	out.TotalDistanceKm = distanceM / 1000

	var weightedScore float64
	err = s.DB.QueryRowContext(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE severity = 'high'),
		       COALESCE(sum(CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END),0)
		FROM incidents`).
		Scan(&out.TotalIncidents, &out.HighSeverityCount, &weightedScore)
	if err != nil {
		return out, fmt.Errorf("overview incidents: %w", err)
	}

	if out.TotalDistanceKm > 0 {
		ratePerKm := weightedScore / out.TotalDistanceKm
		out.SafetyScore = 100 * math.Exp(-ratePerKm/15)
	} else {
		out.SafetyScore = 100
	}
	return out, nil
}

func (s *Store) Heatmap(ctx context.Context) ([]models.HeatpointBucket, error) {
	const q = `
		SELECT round(lat::numeric, 3)::float8 AS glat,
		       round(lon::numeric, 3)::float8 AS glon,
		       count(*) AS c,
		       count(*) FILTER (WHERE severity = 'high') AS high_c,
		       count(*) FILTER (WHERE severity = 'medium') AS medium_c,
		       count(*) FILTER (WHERE severity = 'low') AS low_c
		FROM incidents
		GROUP BY glat, glon
		ORDER BY c DESC`
	rows, err := s.DB.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("heatmap: %w", err)
	}
	defer rows.Close()

	var out []models.HeatpointBucket
	for rows.Next() {
		var b models.HeatpointBucket
		if err := rows.Scan(&b.Lat, &b.Lon, &b.Count, &b.HighCount, &b.MediumCount, &b.LowCount); err != nil {
			return nil, fmt.Errorf("scan heatpoint: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ResetTelemetry clears all rides and their dependent telemetry rows.
func (s *Store) ResetTelemetry(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM rides`)
	if err != nil {
		return fmt.Errorf("reset telemetry: %w", err)
	}
	return nil
}
