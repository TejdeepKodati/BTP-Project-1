package models

import "time"

type Ride struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	// ScenarioID is populated for deterministic custom-scenario simulations.
	// Device rides and legacy imports leave it empty.
	ScenarioID     string     `json:"scenario_id,omitempty"`
	BikeType       int        `json:"bike_type"`
	PhoneLocation  int        `json:"phone_location"`
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
	DistanceMeters float64    `json:"distance_m"`
	PointCount     int            `json:"point_count"`
	IncidentCount  int            `json:"incident_count"`
	CreatedAt      time.Time      `json:"created_at"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// RidePoint is a single sensor reading. The field names mirror the SimRa
// ride CSV schema (see the SimRa dataset README) rather than raw Android
// sensor names, so anyone reading this struct next to the dataset docs can
// map the two directly.
type RidePoint struct {
	ID               int64    `json:"id"`
	RideID           string   `json:"ride_id"`
	Seq              int      `json:"seq"`
	Lat              float64  `json:"lat"`
	Lon              float64  `json:"lon"`
	AccelX           float64  `json:"accel_x"`
	AccelY           float64  `json:"accel_y"`
	AccelZ           float64  `json:"accel_z"`
	GyroA            float64  `json:"gyro_a"`
	GyroB            float64  `json:"gyro_b"`
	GyroC            float64  `json:"gyro_c"`
	LinAccelX        float64  `json:"lin_accel_x"`
	LinAccelY        float64  `json:"lin_accel_y"`
	LinAccelZ        float64  `json:"lin_accel_z"`
	ObsDistLeftM     *float64 `json:"obs_dist_left_m,omitempty"`
	ObsDistRightM    *float64 `json:"obs_dist_right_m,omitempty"`
	ObsDistSameLaneM *float64 `json:"obs_dist_same_lane_m,omitempty"`
	// The following fields describe the configured synthetic route. They are
	// optional so existing device/SimRa-schema uploads remain unchanged.
	ScenarioID           string    `json:"scenario_id,omitempty"`
	LaneType             string    `json:"lane_type,omitempty"`
	EgoAgentType         string    `json:"ego_agent_type,omitempty"`
	ConflictCategory     string    `json:"conflict_category,omitempty"`
	CounterpartID        string    `json:"counterpart_id,omitempty"`
	CounterpartAgentType string    `json:"counterpart_agent_type,omitempty"`
	RecordedAt           time.Time `json:"recorded_at"`
}

// Incident is a moment the detection engine flagged as worth a rider's or
// a planner's attention. IncidentType and Severity are deliberately plain
// strings (not enums) so new rule types can be added without a migration.
type Incident struct {
	ID                   int64     `json:"id"`
	RideID               string    `json:"ride_id"`
	PointID              int64     `json:"point_id"`
	IncidentType         string    `json:"incident_type"`
	Severity             string    `json:"severity"`
	Magnitude            float64   `json:"magnitude"`
	Lat                  float64   `json:"lat"`
	Lon                  float64   `json:"lon"`
	DetectedAt           time.Time `json:"detected_at"`
	ScenarioID           string    `json:"scenario_id,omitempty"`
	LaneType             string    `json:"lane_type,omitempty"`
	ConflictCategory     string    `json:"conflict_category,omitempty"`
	CounterpartID        string    `json:"counterpart_id,omitempty"`
	CounterpartAgentType string    `json:"counterpart_agent_type,omitempty"`
	Evidence             string    `json:"evidence,omitempty"`
}

// EncounterSample holds a time-aligned telemetry sample for a bicycle-counterpart encounter.
type EncounterSample struct {
	TimeS            float64 `json:"time_s"`
	TimestampMs      int64   `json:"timestamp_ms"`
	DistanceM        float64 `json:"distance_m"`
	Side             string  `json:"side"`
	EgoSpeed         float64 `json:"ego_speed"`
	EgoAccel         float64 `json:"ego_accel"`
	CounterpartSpeed float64 `json:"counterpart_speed"`
	Lat              float64 `json:"lat"`
	Lon              float64 `json:"lon"`
}

type RideInteraction struct {
	CounterpartID        string            `json:"counterpart_id"`
	CounterpartAgentType string            `json:"counterpart_agent_type"`
	EgoAgentType         string            `json:"ego_agent_type"`
	ConflictCategory     string            `json:"conflict_category,omitempty"`
	SampleCount          int               `json:"sample_count"`
	IncidentCount        int               `json:"incident_count"`
	MinDistanceM         float64           `json:"min_distance_m"`
	HighCount            int               `json:"high_count"`
	MediumCount          int               `json:"medium_count"`
	LowCount             int               `json:"low_count"`
	Lat                  float64           `json:"lat"`
	Lon                  float64           `json:"lon"`
	Status               string            `json:"status"`
	Samples              []EncounterSample `json:"samples,omitempty"`
}

type IngestPoint struct {
	Lat              float64  `json:"lat"`
	Lon              float64  `json:"lon"`
	AccelX           float64  `json:"accel_x"`
	AccelY           float64  `json:"accel_y"`
	AccelZ           float64  `json:"accel_z"`
	GyroA            float64  `json:"gyro_a"`
	GyroB            float64  `json:"gyro_b"`
	GyroC            float64  `json:"gyro_c"`
	LinAccelX        float64  `json:"lin_accel_x"`
	LinAccelY        float64  `json:"lin_accel_y"`
	LinAccelZ        float64  `json:"lin_accel_z"`
	ObsDistLeftM     *float64 `json:"obs_dist_left_m,omitempty"`
	ObsDistRightM    *float64 `json:"obs_dist_right_m,omitempty"`
	ObsDistSameLaneM *float64 `json:"obs_dist_same_lane_m,omitempty"`
	TimestampMs      int64    `json:"timestamp_ms"`
}

// IngestRideRequest is the POST /api/rides body. It carries the whole ride
// at once (simulator use case). A future streaming endpoint for a live
// device connection can reuse IngestPoint without touching this type.
type IngestRideRequest struct {
	Source        string        `json:"source"`
	BikeType      int           `json:"bike_type"`
	PhoneLocation int           `json:"phone_location"`
	Points        []IngestPoint `json:"points"`
}

// OverviewStats powers the dashboard's headline numbers.
type OverviewStats struct {
	TotalRides        int     `json:"total_rides"`
	TotalDistanceKm   float64 `json:"total_distance_km"`
	TotalIncidents    int     `json:"total_incidents"`
	HighSeverityCount int     `json:"high_severity_count"`
	SafetyScore       float64 `json:"safety_score"` // 0-100, higher is safer
}

// HeatpointBucket is one grid cell in the incident heatmap: a rounded
// lat/lon, how many incidents fell in it, and a severity breakdown so the
// map can color a hotspot by how bad it typically is, not just how often
// something gets flagged there. Rounding coordinates instead of returning
// every incident is what keeps this endpoint cheap to cache and cheap to
// render.
type HeatpointBucket struct {
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	Count       int     `json:"count"`
	HighCount   int     `json:"high_count"`
	MediumCount int     `json:"medium_count"`
	LowCount    int     `json:"low_count"`
}
