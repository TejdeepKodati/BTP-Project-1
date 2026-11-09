# BTP-Project-1

**Final Year Undergraduate Project 1**

- **Area:** Pervasive Computing, Embedded Systems & Cloud-based Safety Monitoring
- **Supervisor:** Prof. Debasree Das
- **Institution:** Department of Computer Science & Engineering, IIT (ISM) Dhanbad

---

## CycleSafe: Pervasive Telemetry & Machine Learning Bicycle Safety Platform

**CycleSafe** is an end-to-end cyclist safety telemetry and cloud analytics platform designed to monitor, simulate, and classify hazardous traffic interactions (close passes, emergency braking, turning hooks) across urban multi-bicycle road networks.

The platform bridges real-world crowdsourced empirical bicycle sensor datasets (**TU Berlin SimRa project**) with high-fidelity microscopic traffic simulation (**Eclipse SUMO / TraCI**) and a trained **XGBoost Machine Learning Classifier** to evaluate conflict severity without relying on hardcoded heuristics.

---

## Key Capabilities & Architecture

```
                         ┌────────────────────────────────────────┐
                         │           Web Dashboard (UI)           │
                         │   • Dual Bicycle & Vehicle Selectors   │
                         │   • Spatial Incident Hotspot Clustering│
                         │   • Leaflet Maps & Chart.js Telemetry  │
                         └───────────────────┬────────────────────┘
                                             │ HTTP :8081 / :80
                         ┌───────────────────▼────────────────────┐
                         │            Nginx Frontend              │
                         │          Proxies /api → :8080          │
                         └───────────────────┬────────────────────┘
                                             │ HTTP :8080
                         ┌───────────────────▼────────────────────┐
                         │            Go Backend API              │
                         │    • Ingestion, Routing, Analytics     │
                         │    • Asynchronous SUMO Job Streamer    │
                         └───────────┬───────────────────┬────────┘
                                     │                   │
                        ┌────────────▼──────┐     ┌──────▼────────┐
                        │   PostgreSQL 16   │     │    Redis 7    │
                        │ (Rides, Points,   │     │ (Stats, Cache,│
                        │  Incidents, Geo)  │     │  Heatmaps)    │
                        └───────────────────┘     └───────────────┘
                                     ▲
                                     │ RPC / HTTP :8090
                        ┌────────────┴────────────────────────────┐
                        │          SUMO Simulation Runner         │
                        │  • Eclipse SUMO 1.27.1 + Python TraCI   │
                        │  • Multi-Bicycle Context Subscriptions  │
                        │  • Oberbaumbrücke 2025 Traffic Shares   │
                        │  • XGBoost Safety Classification Engine │
                        └─────────────────────────────────────────┘
```

### 1. Multi-Bicycle Road Network Simulation
- **Canonical Berlin Corridor**: Mapped along the Ernst-Reuter-Platz → Oberbaumbrücke route (~9.5 km), Germany / right-hand traffic network.
- **Continuous 2D Spatial Subscriptions**: Tracks simulated bicycles (`ego_bicycle`, `bike_0001` ...) running concurrent bidirectional corridor routes with TraCI context subscriptions.
- **Empirical Traffic Calibration**: Calibrated against official 12-hour Berlin SenMVKU intersection counts (Cars: 90.6%, Trucks/Buses: 5.0%, Motorcycles: 4.4%, Bicycles: ~116/hr) with stochastic arrival generation.
- **Geometric Edge Clearance**: Computes exact physical polygon edge-to-edge separation distances between bicycles and surrounding vehicle boundaries at every 0.5s step.

### 2. Machine Learning Safety Engine (XGBoost)
- **Empirical Training Data**: Trained on real-world crowdsourced cyclist incident logs from TU Berlin's **SimRa dataset** (`simra_data/`) combined with continuous TraCI surrogate safety kinematics (1,524 samples).
- **Features Evaluated**:
  - Lateral Clearance Distance ($m$) — *47.0% importance gain*
  - Time-To-Collision (TTC in seconds) — *24.4% importance gain*
  - Deceleration Magnitude / Braking Spike ($m/s^2$) — *20.7% importance gain*
  - Relative & Individual Speeds ($\Delta v, v_{bike}, v_{veh}$) — *5.3% importance gain*
  - Counterpart Vehicle Category (Bicycle, Passenger Car, Heavy-Duty Truck/Bus, Motorcycle) — *1.6% importance gain*
- **Classification Output**: 3-class probability distribution:
  - `Safe Pass` (Separation maintained, smooth velocities)
  - `Close Pass (Medium)` (Lateral distance $1.0 - 1.5$ m, moderate speed differential)
  - `Severe Incident (Critical)` (Lateral distance $< 1.0$ m or emergency deceleration $< -2.8\ m/s^2$)
- **Dual-Engine Predictor**: Native `xgboost.Booster` with automatic fallback to an internal pure-Python tree ensemble parser for zero-dependency portability in containers.
- **Methodology & Limitations**: High classification score reflects exact learning of the deterministic kinematic conflict boundary (StVO § 5(4) clearance, TTC, and deceleration thresholds).

### 3. Interactive Web Dashboard
- **Dual Dynamic Selectors**: Left selector chooses the **Primary Bicycle** (strictly actual bicycles recorded in the run); right selector chooses recorded **Counterpart Vehicles** (filtered by interaction family: *All, Bicycle ↔ Bicycle, Bicycle ↔ Car, Bicycle ↔ Truck/Bus, Bicycle ↔ Motorcycle*).
- **Data Integrity**: No placeholder/mock vehicles, no self-pairing options, no fabricated 999m records, and no hardcoded safety scores.
- **Pair-Specific Telemetry**: Acceleration/braking curves, proximity time-series, and Leaflet map markers reflect strictly the selected pair.
- **Incident Hotspot Clustering**: Spatially aggregates conflicts occurring within 25 m into distinct collision hotspots on Leaflet maps with interactive pin hover tooltips.

### 4. Embedded Hardware Architecture & Circuit Blueprint (Lab Prototyping)
- **Circuit Blueprints & Schematics**: Complete 30-pin ESP32 DevKit pinout allocations, dual JSN-SR04T waterproof ultrasonic distance sensors, u-blox NEO-6M GPS module, and SSD1306 I2C OLED display.
- **Dynamic Roll Tilt Compensation**: Frame roll angle math ($d_{\text{true}} = d_{\text{measured}} \cdot \cos \phi$) derived from MPU-6050 6-axis IMU accelerometer readings to correct for cornering lean.
- **Verified Bill of Materials**: Complete 14-item BOM verified with domestic Indian suppliers delivering directly to IIT (ISM) Dhanbad (PIN: 826004) under INR 3,500, serving as the design blueprint for upcoming physical prototyping in the department laboratory.

---

## Repository Structure

```
├── backend/                  # High-performance Go REST API
│   ├── cmd/server/           # API server entrypoint
│   ├── internal/api/         # HTTP routes, simulation streamer, and handlers
│   ├── internal/db/          # PostgreSQL database schema and queries
│   ├── internal/cache/       # Redis caching helpers
│   ├── internal/detection/   # Spatial episode aggregation and incident models
│   └── internal/models/      # Go data structures (Ride, Point, Incident)
├── frontend/                 # Web Dashboard
│   ├── index.html            # Dashboard shell (dark/light mode, corridor views)
│   ├── css/styles.css        # Responsive styling and interaction tokens
│   └── js/                   # Leaflet map renderer, Chart.js graphs, and UI logic
├── ml/                       # Machine Learning Safety Engine
│   ├── fetch_simra.py        # Automated TU Berlin SimRa dataset downloader
│   ├── train_xgboost.py      # XGBoost multi-class training and evaluation script
│   ├── predictor.py          # Production dual-backend inference engine
│   ├── xgboost_safety_model.json # Serialized XGBoost model
│   └── model_meta.json       # Feature importances and evaluation metrics
├── hardware/                 # Embedded Hardware Architecture & Circuit Blueprints
│   ├── hardware_components_specification.md # Indian supplier BOM & component procurement specs
│   ├── HARDWARE_THEORY_AND_SCHEMATICS.md   # ESP32 pinouts, I2C bus wiring, and IMU tilt math
│   ├── 3D_PRINTED_CASE_GUIDE.md           # Weatherproof PETG enclosure STL package & slicer specs
│   └── PCB_FABRICATION_GUIDE.md           # 2-layer FR-4 custom PCB gerbers & soldering guide
├── simra_data/               # Real-world Berlin SimRa ride CSVs (TU Berlin)
├── sumo/                     # Microscopic Traffic Simulation
│   ├── Dockerfile            # Sumo-runner container definition
│   ├── runner.py             # TraCI simulation engine & ML integration
│   ├── predictor.py          # Container predictor module
│   ├── xgboost_safety_model.json # Container model asset
│   ├── nodes.nod.xml         # Network nodes
│   ├── edges.edg.xml         # Network edges and lane definitions
│   └── corridor_route.json   # Georeferenced Berlin corridor coordinates
├── docker-compose.yml        # Docker Compose configuration (5 services)
└── .gitignore                # Repository ignore rules
```

---

## Quickstart & Running Instructions

### Prerequisites
- [Docker](https://www.docker.com/) & Docker Compose
- Python 3.10+ (if training models locally outside Docker)

### 1. Launch Services
Start all 5 orchestrated containers (`frontend`, `backend`, `sumo-runner`, `postgres`, `redis`):

```bash
docker compose up -d --build
```

### 2. Access the Applications
- **Interactive Dashboard:** [http://localhost:8081](http://localhost:8081)
- **Backend REST API:** [http://localhost:8080](http://localhost:8080)
- **SUMO TraCI Runner:** [http://localhost:8090](http://localhost:8090)

### 3. Triggering a Multi-Bicycle ML Simulation
From the web UI, navigate to the **Road Network** tab and select any demand window (e.g., `07:00-08:00 Peak`), then click **Run Multi-Traffic Simulation**.

Alternatively, trigger directly via the API:

```bash
curl -X POST http://localhost:8080/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"scenario_id": "berlin-multi-traffic", "seed": 42, "conflict": "all", "demand_window": "60m"}'
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/healthz` | System health and container status |
| `GET` | `/api/stats/overview` | Fleet-wide telemetry, total distance, incident counts |
| `GET` | `/api/stats/heatmap` | Spatial incident density coordinates for Leaflet heatmaps |
| `GET` | `/api/rides` | List all historical recorded simulation runs |
| `GET` | `/api/rides/{id}` | Summary header for a specific ride |
| `GET` | `/api/rides/{id}/points` | Full time-series GPS and sensor telemetry stream |
| `GET` | `/api/rides/{id}/incidents` | Detected conflicts and incidents with GPS coordinates |
| `GET` | `/api/rides/{id}/interactions` | Pairwise vehicle-bicycle encounters with XGBoost predictions |
| `POST` | `/api/simulate` | Initiates an asynchronous SUMO simulation run |
| `GET` | `/api/simulate/status?job_id=...`| Tracks simulation progress and automatically ingests completed runs |

---

## Model Retraining

To fetch fresh SimRa ride files and retrain the XGBoost classifier:

```bash
# 1. Download latest Berlin SimRa ride traces
python ml/fetch_simra.py

# 2. Train and evaluate the XGBoost safety classifier
python ml/train_xgboost.py
```
Model artifacts and evaluation metrics will automatically update in `ml/` and `sumo/`.
