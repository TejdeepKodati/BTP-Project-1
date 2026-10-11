package network

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

const Backend = "sumo_traci"

//go:embed config.json
var configJSON []byte

type Config struct {
	Version            string             `json:"version"`
	Backend            string             `json:"backend"`
	SUMOIntegrated     bool               `json:"sumo_integrated"`
	Country            string             `json:"country"`
	CountryCode        string             `json:"country_code"`
	TrafficSide        string             `json:"traffic_side"`
	GeometrySource     string             `json:"geometry_source"`
	Description        string             `json:"description"`
	DefaultScenarioID  string             `json:"default_scenario_id"`
	SelectedScenarioID string             `json:"selected_scenario_id"`
	LaneTypes          []LaneType         `json:"lane_types"`
	AgentTypes         []AgentType        `json:"agent_types"`
	ConflictCategories []ConflictCategory `json:"conflict_categories"`
	Nodes              []Node             `json:"nodes"`
	Edges              []Edge             `json:"edges"`
	Scenarios          []Scenario         `json:"scenarios"`
	Limitations        []string           `json:"limitations"`
}

type LaneType struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	AllowedAgents []string `json:"allowed_agents"`
}

type AgentType struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type ConflictCategory struct {
	ID       string   `json:"id"`
	LaneType string   `json:"lane_type"`
	Agents   []string `json:"agents"`
}

type Node struct {
	ID  string  `json:"id"`
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type Edge struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Lanes []Lane `json:"lanes"`
}

type Lane struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	WidthM       float64 `json:"width_m"`
	OffsetRightM float64 `json:"offset_right_m"`
}

type Scenario struct {
	ID               string        `json:"id"`
	Name             string        `json:"name"`
	Description      string        `json:"description"`
	LaneType         string        `json:"lane_type"`
	Agents           []string      `json:"agents"`
	ConflictCategory string        `json:"conflict_category"`
	RouteLaneIDs     []string      `json:"route_lane_ids"`
	Seed             int64         `json:"seed"`
	StartTime        string        `json:"start_time"`
	SampleCount      int           `json:"sample_count"`
	SampleIntervalS  float64       `json:"sample_interval_s"`
	BicycleSpeedMS   float64       `json:"bicycle_speed_m_s"`
	Events           []ScriptEvent `json:"events"`
}

// ScriptEvent is synthetic ground truth, not inferred counterpart identity.
// Signals feed the existing detector; conflict labels come only from this script.
type ScriptEvent struct {
	Seq            int      `json:"seq"`
	Kind           string   `json:"kind"`
	LinAccelY      float64  `json:"lin_accel_y"`
	GyroC          float64  `json:"gyro_c"`
	ClearanceLeftM *float64 `json:"clearance_left_m,omitempty"`
}

// Load returns a fresh copy so request-local selection never changes global state.
func Load() Config {
	var c Config
	if err := json.Unmarshal(configJSON, &c); err != nil {
		panic("invalid embedded network config: " + err.Error())
	}
	c.SelectedScenarioID = c.DefaultScenarioID
	return c
}

func (c Config) SelectScenario(id string) (Scenario, error) {
	if id == "" {
		id = c.DefaultScenarioID
	}
	for _, s := range c.Scenarios {
		if s.ID == id {
			return s, nil
		}
	}
	return Scenario{}, fmt.Errorf("unknown scenario %q", id)
}

func (c Config) FindLane(id string) (Lane, Edge, bool) {
	for _, edge := range c.Edges {
		for _, lane := range edge.Lanes {
			if lane.ID == id {
				return lane, edge, true
			}
		}
	}
	return Lane{}, Edge{}, false
}

func (c Config) FindNode(id string) (Node, bool) {
	for _, node := range c.Nodes {
		if node.ID == id {
			return node, true
		}
	}
	return Node{}, false
}
