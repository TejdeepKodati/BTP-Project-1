CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS rides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(20) NOT NULL DEFAULT 'simulated', -- 'simulated' | 'device'
    scenario_id     VARCHAR(64), -- populated by configured SUMO road-network scenarios
    bike_type       SMALLINT NOT NULL DEFAULT 0,
    phone_location  SMALLINT NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    distance_m      DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ride_points (
    id              BIGSERIAL PRIMARY KEY,
    ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    seq             INT NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    accel_x         DOUBLE PRECISION NOT NULL DEFAULT 0,
    accel_y         DOUBLE PRECISION NOT NULL DEFAULT 0,
    accel_z         DOUBLE PRECISION NOT NULL DEFAULT 0,
    gyro_a          DOUBLE PRECISION NOT NULL DEFAULT 0,
    gyro_b          DOUBLE PRECISION NOT NULL DEFAULT 0,
    gyro_c          DOUBLE PRECISION NOT NULL DEFAULT 0,
    lin_accel_x     DOUBLE PRECISION NOT NULL DEFAULT 0,
    lin_accel_y     DOUBLE PRECISION NOT NULL DEFAULT 0,
    lin_accel_z     DOUBLE PRECISION NOT NULL DEFAULT 0,
    obs_dist_left_m     DOUBLE PRECISION,
    obs_dist_right_m    DOUBLE PRECISION,
    obs_dist_same_lane_m DOUBLE PRECISION,
    scenario_id     VARCHAR(64),
    lane_type       VARCHAR(32),
    ego_agent_type  VARCHAR(32),
    conflict_category VARCHAR(64),
    counterpart_id VARCHAR(64),
    counterpart_agent_type VARCHAR(32),
    recorded_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ride_points_ride_seq ON ride_points (ride_id, seq);

CREATE TABLE IF NOT EXISTS incidents (
    id              BIGSERIAL PRIMARY KEY,
    ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    point_id        BIGINT NOT NULL REFERENCES ride_points(id) ON DELETE CASCADE,
    incident_type   VARCHAR(30) NOT NULL, -- close_pass | hard_swerve | hard_brake
    severity        VARCHAR(10) NOT NULL, -- low | medium | high
    magnitude       DOUBLE PRECISION NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    detected_at     TIMESTAMPTZ NOT NULL,
    scenario_id     VARCHAR(64),
    lane_type       VARCHAR(32),
    conflict_category VARCHAR(64),
    counterpart_id VARCHAR(64),
    counterpart_agent_type VARCHAR(32),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_ride ON incidents (ride_id);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents (lat, lon);

-- The schema is embedded and reapplied on boot. These guards also upgrade a
-- database created by the original prototype without dropping telemetry.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS scenario_id VARCHAR(64);
ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS scenario_id VARCHAR(64);
ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS lane_type VARCHAR(32);
ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS ego_agent_type VARCHAR(32);
ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS conflict_category VARCHAR(64);
ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS obs_dist_same_lane_m DOUBLE PRECISION;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS scenario_id VARCHAR(64);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS lane_type VARCHAR(32);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS conflict_category VARCHAR(64);

ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS counterpart_id VARCHAR(64);
ALTER TABLE ride_points ADD COLUMN IF NOT EXISTS counterpart_agent_type VARCHAR(32);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS counterpart_id VARCHAR(64);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS counterpart_agent_type VARCHAR(32);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS evidence TEXT;
