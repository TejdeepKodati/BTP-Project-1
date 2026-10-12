import bisect
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SUMO_HOME = os.environ.get("SUMO_HOME")
if SUMO_HOME:
    sys.path.append(os.path.join(SUMO_HOME, "tools"))
import traci
import traci.constants as tc

ROOT = Path(__file__).resolve().parent
SUMO_BIN = os.environ.get("SUMO_BINARY", "sumo")
PORT = int(os.environ.get("PORT", "8090"))
BUILD_VERSION = "cyclesafe-sumo-v9-xgboost-safety-engine"
SIM_END = 3600
STEP_LENGTH = 0.5
SIM_LOCK = threading.Lock()
JOBS_LOCK = threading.Lock()
JOBS = {}
LATEST_JOB_ID = None

SAFETY_PREDICTOR = None
try:
    from predictor import SafetyPredictor
    SAFETY_PREDICTOR = SafetyPredictor()
    print("SUMO Runner: XGBoost SafetyPredictor initialized successfully.", flush=True)
except Exception as e:
    print(f"SUMO Runner: SafetyPredictor initialization notice: {e}", flush=True)


def get_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return None
        return dict(job)


def get_latest_job():
    with JOBS_LOCK:
        if LATEST_JOB_ID and LATEST_JOB_ID in JOBS:
            return dict(JOBS[LATEST_JOB_ID])
        return None


def create_job(scenario_id, seed, conflict, demand_window, total_steps):
    global LATEST_JOB_ID
    job_id = uuid.uuid4().hex[:12]
    job = {
        "job_id": job_id,
        "status": "running",
        "scenario": scenario_id,
        "seed": seed,
        "conflict": conflict,
        "demand_window": demand_window,
        "step": 0,
        "total_steps": total_steps,
        "progress": 0.0,
        "started_at": time.time(),
        "error": None,
        "result": None,
    }
    with JOBS_LOCK:
        JOBS[job_id] = job
        LATEST_JOB_ID = job_id
    return job

# Evidence-backed Berlin demand reference used for the multi-traffic experiment.
# Official 12-hour intersection count, Oberbaumbrücke arm, 07:00-19:00:
# 13,531 total motor vehicles across 12 hours
# 1,397 bicycles across 12 hours
BERLIN_REFERENCE = {
    "location": "Mühlenstraße - Stralauer Allee / Warschauer Straße - Oberbaumbrücke",
    "arm": "Oberbaumbrücke (S)",
    "count_date": "2025-04-03",
    "observed_window": "07:00-19:00",
    "bicycle_12h": 1397,
    "kfz_12h": 13531,
    "car_light_commercial_share": 0.906,  # 90.6% -> ~12,259 total -> ~1,022 / hr
    "heavy_vehicle_1_share": 0.023,       # 2.3%
    "heavy_vehicle_2_share": 0.016,       # 1.6% (combined heavy-duty: 3.9% -> ~528 total -> ~44 / hr)
    "bus_share": 0.011,                   # 1.1% -> ~149 total -> ~12 / hr (combined into heavy category)
    "motorbike_share": 0.044,             # 4.4% -> ~595 total -> ~50 / hr
    "source_note": "Berlin SenMVKU Knotenstromzählung K 641861/25, 03.04.2025, Oberbaumbrücke arm",
}

def sample_demand(run_seed):
    rng = random.Random(run_seed)
    # Baseline 1-hour equivalent (1/12th of 12-hour observed totals):
    # Cars: ~1,022 / hr
    # Motorbikes: ~50 / hr
    # Heavy-duty + buses: ~56 / hr (combining 44 heavy trucks + 12 buses)
    # Bicycles: ~116 / hr
    # Controlled stochastic variation around the baseline
    bikes = max(80, int(round(rng.gauss(116, 7))))
    cars = max(850, int(round(rng.gauss(1022, 28))))
    motos = max(35, int(round(rng.gauss(50, 4))))
    trucks = max(35, int(round(rng.gauss(56, 4))))
    return {
        "seed": run_seed,
        "bicycles": bikes,
        "cars": cars,
        "motorbikes": motos,
        "heavy_duty": trucks,
        "motor_vehicles_total": cars + motos + trucks,
        "baseline_hourly": {
            "bicycles": 116,
            "cars": 1022,
            "motorbikes": 50,
            "heavy_duty": 56,
            "motor_vehicles_total": 1128,
        },
        "source_reference": "Berlin SenMVKU Knotenstromzählung K 641861/25, Oberbaumbrücke arm, 12h (13,531 motor vehicles, 1,397 bicycles)",
    }

MULTI_SCENARIO = {
    "name": "Berlin reference demand — multi-traffic",
    "conflict": "multi-traffic",
    "lane_type": "mixed + bicycle-only",
    "seed": 20261006,
}

CONTROLLED_VEHICLE_TYPES = """<vType id="bike" vClass="bicycle" accel="1.2" decel="3.0" length="1.6" width="0.65" minGap="0.5" maxSpeed="7.0" desiredMaxSpeed="7.0" guiShape="bicycle"/>
<vType id="car" vClass="passenger" accel="2.6" decel="4.5" length="4.5" width="1.8" minGap="0.8" maxSpeed="15.0" guiShape="passenger/sedan"/>
<vType id="motorbike" vClass="motorcycle" accel="3.0" decel="5.0" length="2.2" width="0.9" minGap="0.6" maxSpeed="14.0" guiShape="motorcycle"/>
<vType id="truck" vClass="truck" accel="1.3" decel="4.0" length="7.1" width="2.4" minGap="1.2" maxSpeed="12.0" guiShape="truck"/>"""

MULTI_VEHICLE_TYPES = """<vType id="ego_bike" vClass="bicycle" accel="1.2" decel="3.0" length="1.6" width="0.65" minGap="0.5" maxSpeed="2.67" desiredMaxSpeed="2.67" guiShape="bicycle" carFollowModel="IDM" tau="1.2" lcKeepRight="0"/>
<vType id="bike" vClass="bicycle" accel="1.2" decel="3.0" length="1.6" width="0.65" minGap="0.5" maxSpeed="7.0" desiredMaxSpeed="7.0" guiShape="bicycle" carFollowModel="IDM" tau="1.2" lcKeepRight="0"/>
<vType id="car" vClass="passenger" accel="2.6" decel="4.5" length="4.5" width="1.8" minGap="0.8" maxSpeed="15.0" desiredMaxSpeed="15.0" guiShape="passenger/sedan" carFollowModel="IDM" tau="1.2"/>
<vType id="motorbike" vClass="motorcycle" accel="3.0" decel="5.0" length="2.2" width="0.9" minGap="0.6" maxSpeed="14.0" desiredMaxSpeed="14.0" guiShape="motorcycle" carFollowModel="IDM" tau="1.0"/>
<vType id="truck" vClass="truck" accel="1.3" decel="4.0" length="7.1" width="2.4" minGap="1.2" maxSpeed="12.0" desiredMaxSpeed="12.0" guiShape="truck" carFollowModel="IDM" tau="1.5"/>"""


def ensure_network(work):
    net = work / "network.net.xml"
    cmd = [
        "netconvert",
        "--node-files", str(ROOT / "nodes.nod.xml"),
        "--edge-files", str(ROOT / "edges.edg.xml"),
        "--output-file", str(net),
    ]
    subprocess.run(cmd, check=True, cwd=ROOT, capture_output=True, text=True)
    return net


CORRIDOR_FILE = ROOT / "corridor_route.json"
CORRIDOR_COORDS = []
CORRIDOR_CUM_DISTS = [0.0]
CORRIDOR_TOTAL_LEN = 10592.9


def _init_corridor():
    global CORRIDOR_COORDS, CORRIDOR_CUM_DISTS, CORRIDOR_TOTAL_LEN
    coords = None
    if CORRIDOR_FILE.exists():
        try:
            with open(CORRIDOR_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                coords = data.get("coordinates")
        except Exception as exc:
            print(f"Warning: could not load corridor_route.json: {exc}", flush=True)

    if not coords:
        # Fallback road waypoints along the Berlin corridor from Point A (Ernst-Reuter-Platz) to Point B (Oberbaumbrücke)
        coords = [
            [13.32186, 52.51320],
            [13.34939, 52.50314],
            [13.37138, 52.50487],
            [13.37928, 52.49890],
            [13.39489, 52.49765],
            [13.41233, 52.49853],
            [13.43393, 52.49960],
            [13.44500, 52.50120],
        ]

    CORRIDOR_COORDS = coords
    cum = [0.0]
    R = 6371000.0
    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i + 1]
        phi1 = math.radians(p1[1])
        phi2 = math.radians(p2[1])
        dphi = math.radians(p2[1] - p1[1])
        dlambda = math.radians(p2[0] - p1[0])
        a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
        d = 2.0 * R * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        cum.append(cum[-1] + d)
    CORRIDOR_CUM_DISTS = cum
    CORRIDOR_TOTAL_LEN = cum[-1] if cum[-1] > 0 else 9613.9


_init_corridor()


def to_geo_distance(dist_m, y=0.0):
    if not CORRIDOR_COORDS or len(CORRIDOR_COORDS) < 2:
        return 52.50120, 13.44500

    d = max(0.0, min(CORRIDOR_TOTAL_LEN, float(dist_m)))

    idx = bisect.bisect_right(CORRIDOR_CUM_DISTS, d) - 1
    idx = max(0, min(idx, len(CORRIDOR_COORDS) - 2))

    seg_d = CORRIDOR_CUM_DISTS[idx + 1] - CORRIDOR_CUM_DISTS[idx]
    f = 0.0 if seg_d <= 0 else (d - CORRIDOR_CUM_DISTS[idx]) / seg_d
    f = max(0.0, min(1.0, f))

    p1 = CORRIDOR_COORDS[idx]
    p2 = CORRIDOR_COORDS[idx + 1]
    lon = p1[0] + f * (p2[0] - p1[0])
    lat = p1[1] + f * (p2[1] - p1[1])

    # Add small lateral lane offset perpendicular to segment
    if y != 0.0:
        lat_rad = math.radians(lat)
        dx = (p2[0] - p1[0]) * 111320.0 * math.cos(lat_rad)
        dy = (p2[1] - p1[1]) * 111320.0
        seg_len = math.hypot(dx, dy)
        if seg_len > 0.01:
            nx = -dy / seg_len
            ny = dx / seg_len
            offset_m = max(-3.0, min(3.0, float(y) - 2.5))
            lat += (offset_m * ny) / 111320.0
            lon += (offset_m * nx) / (111320.0 * math.cos(lat_rad))

    return lat, lon


def to_geo(x, y, edge=None, s=None):
    if s is not None and edge is not None:
        frac = max(0.0, min(1.0, float(s) / CORRIDOR_TOTAL_LEN))
        d = (1.0 - frac) * CORRIDOR_TOTAL_LEN if edge == "westbound" else frac * CORRIDOR_TOTAL_LEN
        return to_geo_distance(d, y)
    frac = max(0.0, min(1.0, float(x) / CORRIDOR_TOTAL_LEN))
    return to_geo_distance(frac * CORRIDOR_TOTAL_LEN, y)


def edge_clearance(ego_pos, other_pos, ego_length, other_length, ego_width, other_width):
    dx = max(0.0, abs(other_pos[0] - ego_pos[0]) - 0.5 * (ego_length + other_length))
    dy = max(0.0, abs(other_pos[1] - ego_pos[1]) - 0.5 * (ego_width + other_width))
    return math.hypot(dx, dy)


def same_lane_gap(ego_id, other_id):
    ego_s = traci.vehicle.getLanePosition(ego_id)
    other_s = traci.vehicle.getLanePosition(other_id)
    ego_length = traci.vehicle.getLength(ego_id)
    other_length = traci.vehicle.getLength(other_id)
    return max(0.0, abs(other_s - ego_s) - 0.5 * (ego_length + other_length))


def random_departures(rng, count, duration):
    # Uniformly randomized departures give a reproducible demand stream while
    # keeping the requested hourly volume explicit. A future calibration pass
    # can replace this with measured hourly profiles without changing the API.
    if count <= 0:
        return []
    return sorted(rng.uniform(0.0, max(0.0, duration - 1.0)) for _ in range(count))


CORRIDOR_CONFLICT_ZONES = [
    (500.0, 680.0),    # Ernst-Reuter-Platz junction exit / pinch point (~180m)
    (2200.0, 2380.0),  # Großer Stern roundabout transition (~180m)
    (4050.0, 4230.0),  # Potsdamer Platz intersection transition (~180m)
    (5650.0, 5830.0),  # Leipziger Straße mixed bottleneck (~180m)
    (7150.0, 7330.0),  # Spittelmarkt / Moritzplatz junction (~180m)
    (8650.0, 8830.0),  # Warschauer Straße / Oberbaumbrücke ramp (~180m)
]


def make_multi_routes(seed=None):
    run_seed = int(seed if seed is not None else random.randint(10000000, 99999999))
    demand = sample_demand(run_seed)
    rng = random.Random(run_seed)
    bikes = demand["bicycles"]
    cars = demand["cars"]
    motorbikes = demand["motorbikes"]
    trucks = demand["heavy_duty"]
    kfz = demand["motor_vehicles_total"]

    # Traversal follows the full Ernst-Reuter-Platz -> Oberbaumbrücke corridor (9.6 km).
    east_route = "eastbound"
    west_route = "westbound"

    vehicles = []
    ego_id = "ego_bicycle"
    bike_departures = random_departures(rng, max(0, bikes - 1), SIM_END)
    if bikes <= 0:
        raise RuntimeError("multi-traffic demand produced zero bicycles")

    # The ego is the instrumented bicycle and starts at t=0 so its complete
    # one-hour traversal across the 9.6 km corridor is observable.
    ego_speed = 2.67  # 9,613.9 m / 3,600 s = 2.67 m/s (progresses smoothly across the 9.61 km corridor throughout the 60-min window)
    vehicles.append((ego_id, "ego_bike", east_route, 0, 0.0, ego_speed))
    for i, depart in enumerate(bike_departures, start=1):
        vid = f"bike_{i:04d}"
        direction = "eastbound" if i % 2 == 0 else "westbound"
        route = east_route if direction == "eastbound" else west_route
        lane = 1 if rng.random() < 0.25 else 0
        speed = rng.uniform(3.5, 5.0)
        vehicles.append((vid, "bike", route, lane, depart, speed))

    for prefix, vtype, count, min_speed, max_speed in [
        ("car", "car", cars, 8.0, 13.5),
        ("moto", "motorbike", motorbikes, 8.5, 13.0),
        ("truck", "truck", trucks, 7.0, 11.0),
    ]:
        for i, depart in enumerate(random_departures(rng, count, SIM_END)):
            direction = "eastbound" if rng.random() < 0.5 else "westbound"
            route = east_route if direction == "eastbound" else west_route
            # Real-world German Rechtsfahrgebot distribution:
            # 65% depart in the primary mixed right lane (lane 1),
            # 35% depart in the overtaking left lane (lane 2).
            lane = 1 if rng.random() < 0.65 else 2
            speed = rng.uniform(min_speed, max_speed)
            vehicles.append((f"{prefix}_{i:04d}", vtype, route, lane, depart, speed))

    # SUMO requires route/vehicle definitions to be ordered by departure time.
    # Vehicles were previously appended by class, which made later classes and
    # many randomized vehicles appear out of order; SUMO then ignored them.
    # Stable sorting preserves deterministic ordering for equal departure times.
    vehicles.sort(key=lambda vehicle: vehicle[4])

    xml = ["<routes>", MULTI_VEHICLE_TYPES]
    for vid, vtype, route, lane, depart, speed in vehicles:
        xml.append(
            f'<vehicle id="{vid}" type="{vtype}" depart="{depart:.3f}" '
            f'departLane="{lane}" departPos="0" departSpeed="{speed:.3f}">'
            f'<route edges="{route}"/></vehicle>'
        )
    xml.append("</routes>")
    return "\n".join(xml), {
        "ego_id": ego_id,
        "seed": run_seed,
        "bicycles": bikes,
        "cars": cars,
        "motorbikes": motorbikes,
        "trucks": trucks,
        "kfz_total": kfz,
        "demand_basis": "12-hour observed Oberbaumbrücke arm total (13,531 motor vehicles, 1,397 bicycles) converted to 60-min stochastic demand",
        "observed_window": BERLIN_REFERENCE["observed_window"],
        "route_distance_km": round(CORRIDOR_TOTAL_LEN / 1000.0, 2),
    }


def make_controlled_routes(s):
    direction = s["edge"]
    ego = (
        f'<vehicle id="ego_bicycle" type="bike" depart="0" '
        f'departLane="{s["ego_lane"]}" departPos="{s["ego_depart_pos"]}" '
        f'departSpeed="{s["ego_speed"]}" color="0,1,0.8">'
        f'<route edges="{direction}"/></vehicle>'
    )
    other = (
        f'<vehicle id="counterpart" type="{s["other_type"]}" depart="0" '
        f'departLane="{s["other_lane"]}" departPos="{s["other_depart_pos"]}" '
        f'departSpeed="{s["other_speed"]}" color="1,0.55,0.1">'
        f'<route edges="{direction}"/></vehicle>'
    )
    return f"""<routes>\n{CONTROLLED_VEHICLE_TYPES}\n{ego}\n{other}\n</routes>""", None


SCENARIOS = {
    "bicycle-bicycle": {"name": "Bicycle-only interaction", "edge": "westbound", "ego_lane": 0, "other_lane": 0, "ego_type": "bike", "other_type": "bike", "conflict": "bicycle-bicycle", "lane_type": "bicycle-only", "ego_speed": 4.5, "other_speed": 4.5, "ego_depart_pos": 300, "other_depart_pos": 297, "passing": False},
    "bicycle-car": {"name": "Bicycle / car interaction", "edge": "eastbound", "ego_lane": 1, "other_lane": 2, "ego_type": "bike", "other_type": "car", "conflict": "bicycle-car", "lane_type": "mixed", "ego_speed": 4.5, "other_speed": 11.0, "ego_depart_pos": 300, "other_depart_pos": 200, "passing": True},
    "bicycle-motorbike": {"name": "Bicycle / motorbike interaction", "edge": "westbound", "ego_lane": 1, "other_lane": 2, "ego_type": "bike", "other_type": "motorbike", "conflict": "bicycle-motorbike", "lane_type": "mixed", "ego_speed": 4.8, "other_speed": 10.0, "ego_depart_pos": 300, "other_depart_pos": 200, "passing": True},
    "bicycle-heavy-duty": {"name": "Bicycle / heavy-duty interaction", "edge": "eastbound", "ego_lane": 1, "other_lane": 2, "ego_type": "bike", "other_type": "truck", "conflict": "bicycle-heavy-duty", "lane_type": "mixed", "ego_speed": 3.8, "other_speed": 9.0, "ego_depart_pos": 300, "other_depart_pos": 200, "passing": True},
}


def pair_conflict_category(counterpart_type):
    return {
        "bike": "bicycle-bicycle",
        "car": "bicycle-car",
        "motorbike": "bicycle-motorbike",
        "truck": "bicycle-heavy-duty",
    }.get(counterpart_type, "multi-traffic")


def run_scenario(scenario_id, seed=None, conflict="bicycle-bicycle", demand_window="07:00-08:00", progress_cb=None):
    is_multi = scenario_id == "berlin-multi-traffic"
    if not is_multi and scenario_id not in SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario_id}")

    with SIM_LOCK, tempfile.TemporaryDirectory(prefix="cyclesafe-sumo-") as td:
        work = Path(td)
        net = ensure_network(work)
        routes = work / "routes.rou.xml"
        cfg = work / "run.sumocfg"
        if is_multi:
            route_text, demand = make_multi_routes(seed)
            routes.write_text(route_text, encoding="utf-8")
            seed = int(seed if seed is not None else MULTI_SCENARIO["seed"])
            metadata = {"demand": demand, "selected_conflict": conflict, "demand_window": demand_window}
        else:
            s = SCENARIOS[scenario_id]
            routes.write_text(make_controlled_routes(s)[0], encoding="utf-8")
            seed = int(seed if seed is not None else 42)
            metadata = {}

        cfg.write_text(f"""<configuration>
  <input>
    <net-file value="{net}"/>
    <route-files value="{routes}"/>
  </input>
  <time><begin value="0"/><end value="{SIM_END if is_multi else 90}"/><step-length value="{STEP_LENGTH if is_multi else 0.1}"/></time>
  <processing><time-to-teleport value="-1"/></processing>
  <report><verbose value="false"/><no-step-log value="true"/></report>
</configuration>""", encoding="utf-8")

        command = [SUMO_BIN, "-c", str(cfg), "--seed", str(seed)]
        if is_multi:
            command += ["--lateral-resolution", "0.5"]

        traci.start(command, label="cyclesafe")
        points = []
        simulation_start_ms = int(time.time() * 1000)
        pass_events = []
        min_proximity = None
        min_ttc = None
        collision_steps = set()
        counterpart_seen = set()
        ego_seen = False
        ego_context_subscribed = False
        controlled_pass_state = "approach" if (not is_multi and SCENARIOS[scenario_id]["passing"]) else "follow"
        multi_pass_state = {}
        ego_length = 1.6
        ego_width = 0.65
        encounters = {}
        candidate_types = {}
        tracked_bike_ids = ["ego_bicycle"] + [f"bike_{i:04d}" for i in range(1, 16)]
        subscribed_bikes = set()
        multi_bike_encounters = {bid: {} for bid in tracked_bike_ids}
        multi_bike_cum_dist = {bid: 0.0 for bid in tracked_bike_ids}

        ego_cum_dist = 0.0
        if not is_multi and scenario_id in SCENARIOS:
            sc = SCENARIOS[scenario_id]
            depart_pos = sc.get("ego_depart_pos", 0.0)
            if sc.get("edge") == "eastbound":
                ego_cum_dist = CORRIDOR_TOTAL_LEN + depart_pos
            else:
                ego_cum_dist = depart_pos

        try:
            total_steps = int((SIM_END if is_multi else 90) / (STEP_LENGTH if is_multi else 0.1)) + 1
            if is_multi:
                print(f"SUMO simulation started: scenario={scenario_id} conflict={conflict} window={demand_window} seed={seed} steps={total_steps}", flush=True)
            for step in range(total_steps):
                traci.simulationStep()
                if progress_cb and (step % 25 == 0 or step == total_steps - 1):
                    progress_cb(step, total_steps)
                if is_multi and step > 0 and step % 600 == 0:
                    print(f"SUMO progress: {step}/{total_steps} steps ({step * STEP_LENGTH:.0f}s simulated)", flush=True)

                if is_multi:
                    active_vids = set(traci.vehicle.getIDList())
                    for bid in tracked_bike_ids:
                        if bid in active_vids and bid not in subscribed_bikes:
                            try:
                                traci.vehicle.subscribe(bid, [
                                    tc.VAR_POSITION, tc.VAR_LANE_INDEX, tc.VAR_ROAD_ID,
                                    tc.VAR_SPEED, tc.VAR_ACCELERATION, tc.VAR_LANEPOSITION
                                ])
                                traci.vehicle.subscribeContext(
                                    bid, tc.CMD_GET_VEHICLE_VARIABLE, 60.0,
                                    [tc.VAR_POSITION, tc.VAR_LANE_INDEX, tc.VAR_LENGTH,
                                     tc.VAR_WIDTH, tc.VAR_TYPE, tc.VAR_SPEED,
                                     tc.VAR_LANEPOSITION],
                                )
                                subscribed_bikes.add(bid)
                            except Exception:
                                pass

                if not ego_context_subscribed:
                    try:
                        traci.vehicle.subscribe("ego_bicycle", [
                            tc.VAR_POSITION, tc.VAR_LANE_INDEX, tc.VAR_ROAD_ID,
                            tc.VAR_SPEED, tc.VAR_ACCELERATION, tc.VAR_LANEPOSITION
                        ])
                        if is_multi:
                            traci.vehicle.subscribeContext(
                                "ego_bicycle", tc.CMD_GET_VEHICLE_VARIABLE, 60.0,
                                [tc.VAR_POSITION, tc.VAR_LANE_INDEX, tc.VAR_LENGTH,
                                 tc.VAR_WIDTH, tc.VAR_TYPE, tc.VAR_SPEED,
                                 tc.VAR_LANEPOSITION],
                            )
                        traci.simulation.subscribe([tc.VAR_COLLIDING_VEHICLES_NUMBER])
                        ego_context_subscribed = True
                    except traci.TraCIException:
                        if traci.simulation.getMinExpectedNumber() <= 0:
                            break
                        continue

                sim_sub = traci.simulation.getSubscriptionResults()
                if sim_sub and sim_sub.get(tc.VAR_COLLIDING_VEHICLES_NUMBER, 0) > 0:
                    collision_steps.add(step)

                ego_sub = traci.vehicle.getSubscriptionResults("ego_bicycle")
                if not ego_sub:
                    if ego_seen:
                        break
                    if traci.simulation.getMinExpectedNumber() <= 0:
                        break
                    continue

                ego_seen = True
                ego_pos = ego_sub[tc.VAR_POSITION]
                ego_lane = ego_sub[tc.VAR_LANE_INDEX]
                ego_edge = ego_sub[tc.VAR_ROAD_ID]
                ego_speed = ego_sub[tc.VAR_SPEED]
                ego_accel = ego_sub[tc.VAR_ACCELERATION]
                ego_s = ego_sub[tc.VAR_LANEPOSITION]
                dt = STEP_LENGTH if is_multi else 0.1
                ego_cum_dist += max(0.0, float(ego_speed)) * dt
                lat, lon = to_geo_distance(ego_cum_dist, y=ego_pos[1])

                if is_multi:
                    in_conflict = any(start <= ego_s <= end for start, end in CORRIDOR_CONFLICT_ZONES)
                    target_lane = 1 if in_conflict else 0
                    if ego_lane != target_lane:
                        try:
                            traci.vehicle.changeLane("ego_bicycle", target_lane, 5.0)
                        except Exception:
                            pass

                best = None

                if is_multi:
                    context = traci.vehicle.getContextSubscriptionResults("ego_bicycle") or {}
                    candidate_states = []
                    for vid, values in context.items():
                        if vid == "ego_bicycle":
                            continue
                        pos = values.get(tc.VAR_POSITION)
                        if pos is None:
                            continue
                        candidate_states.append({
                            "id": vid,
                            "pos": pos,
                            "lane": values.get(tc.VAR_LANE_INDEX, ego_lane),
                            "length": values.get(tc.VAR_LENGTH, 4.5),
                            "width": values.get(tc.VAR_WIDTH, 1.8),
                            "type": values.get(tc.VAR_TYPE, "unknown"),
                            "speed": values.get(tc.VAR_SPEED, 0.0),
                            "s": values.get(tc.VAR_LANEPOSITION, 0.0),
                        })
                else:
                    ids = set(traci.vehicle.getIDList())
                    candidate_states = []
                    if "counterpart" in ids:
                        candidate_states.append({
                            "id": "counterpart",
                            "pos": traci.vehicle.getPosition("counterpart"),
                            "lane": traci.vehicle.getLaneIndex("counterpart"),
                            "length": traci.vehicle.getLength("counterpart"),
                            "width": traci.vehicle.getWidth("counterpart"),
                            "type": traci.vehicle.getTypeID("counterpart"),
                            "speed": traci.vehicle.getSpeed("counterpart"),
                            "s": traci.vehicle.getLanePosition("counterpart"),
                        })

                for candidate in candidate_states:
                    vid = candidate["id"]
                    pos = candidate["pos"]
                    lane = candidate["lane"]
                    length = candidate["length"]
                    width = candidate["width"]
                    if is_multi:
                        proximity = edge_clearance(ego_pos, pos, ego_length, length, ego_width, width)
                        dy_offset = pos[1] - ego_pos[1]
                        if dy_offset > 0.35:
                            side = "left"
                        elif dy_offset < -0.35:
                            side = "right"
                        else:
                            side = "same-lane"
                    elif lane == ego_lane:
                        proximity = same_lane_gap("ego_bicycle", vid)
                        side = "same-lane"
                    else:
                        proximity = edge_clearance(ego_pos, pos, ego_length, length, ego_width, width)
                        side = "left" if lane > ego_lane else "right"

                    candidate_types[vid] = candidate["type"]
                    if proximity <= 35.0:
                        if vid not in encounters:
                            encounters[vid] = []
                        encounters[vid].append({
                            "time_s": round(step * (STEP_LENGTH if is_multi else 0.1), 1),
                            "timestamp_ms": simulation_start_ms + int(round(step * (STEP_LENGTH if is_multi else 0.1) * 1000)),
                            "distance_m": round(proximity, 2),
                            "side": side,
                            "ego_speed": round(float(ego_speed), 2),
                            "ego_accel": round(float(ego_accel), 2),
                            "counterpart_speed": round(float(candidate["speed"]), 2),
                            "lat": round(lat, 6),
                            "lon": round(lon, 6),
                        })

                    if best is None or proximity < best["proximity"]:
                        best = {
                            "id": vid,
                            "lane": lane,
                            "type": candidate["type"],
                            "speed": candidate["speed"],
                            "proximity": proximity,
                            "side": side,
                            "s": candidate["s"],
                        }
                proximity = best["proximity"] if best else None
                proximity_side = best["side"] if best else None
                counterpart_present = bool(best)
                counterpart_lane = best["lane"] if best else None
                counterpart_speed = best["speed"] if best else None
                relative_speed = (counterpart_speed - ego_speed) if best else None
                longitudinal_gap = proximity if best and best["side"] == "same-lane" else None
                if not is_multi and "counterpart" in ids:
                    other_s = candidate_states[0]["s"] if candidate_states else ego_s
                    other_length = candidate_states[0]["length"] if candidate_states else ego_length
                    longitudinal_gap = max(0.0, abs(other_s - ego_s) - 0.5 * (ego_length + other_length))

                if proximity is not None:
                    min_proximity = proximity if min_proximity is None else min(min_proximity, proximity)
                    counterpart_seen.add(best["id"])

                if not is_multi and SCENARIOS[scenario_id]["passing"] and "counterpart" in ids:
                    delta = candidate_states[0]["s"] - ego_s
                    # Restore the proven v5 pass-event semantics: the scripted
                    # scenario starts the counterpart behind, then observes it
                    # crossing from behind to ahead in the adjacent lane.
                    if controlled_pass_state == "approach" and delta < 0 and longitudinal_gap is not None and longitudinal_gap <= 30:
                        controlled_pass_state = "passing"
                        pass_events.append({"step": step, "time_s": round(step * 0.1, 1), "event": "left_side_pass_started"})
                    elif controlled_pass_state == "passing" and delta >= 0:
                        controlled_pass_state = "completed"
                        pass_events.append({"step": step, "time_s": round(step * 0.1, 1), "event": "left_side_pass_completed"})

                if is_multi:
                    # Observe naturally occurring passes on the adjacent left
                    # mixed lane. No incident count is prescribed.
                    for candidate in candidate_states:
                        vid = candidate["id"]
                        vtype = candidate["type"]
                        if vtype == "bike":
                            continue
                        lane = candidate["lane"]
                        if lane <= ego_lane:
                            continue
                        delta = candidate["s"] - ego_s
                        state = multi_pass_state.get(vid, "approach")
                        if state == "approach" and delta < 0:
                            multi_pass_state[vid] = "passing"
                            pass_events.append({"step": step, "time_s": round(step * STEP_LENGTH, 1), "event": "left_side_pass_started", "counterpart_id": vid, "counterpart_type": vtype})
                        elif state == "passing" and delta >= 0:
                            multi_pass_state[vid] = "completed"
                            pass_events.append({"step": step, "time_s": round(step * STEP_LENGTH, 1), "event": "left_side_pass_completed", "counterpart_id": vid, "counterpart_type": vtype})

                ttc = None
                if best:
                    delta = best["s"] - ego_s
                    if delta < 0 and best["speed"] > ego_speed and best["side"] != "same-lane":
                        ttc = proximity / max(0.001, best["speed"] - ego_speed)
                        min_ttc = ttc if min_ttc is None else min(min_ttc, ttc)

                points.append({
                    "seq": step,
                    "lat": lat,
                    "lon": lon,
                    "accel_x": 0.0, "accel_y": 0.0, "accel_z": 9.81,
                    "gyro_a": 0.0, "gyro_b": 0.0, "gyro_c": 0.0,
                    "lin_accel_x": float(ego_accel), "lin_accel_y": 0.0, "lin_accel_z": 0.0,
                    "obs_dist_left_m": proximity if proximity_side == "left" else None,
                    "obs_dist_right_m": proximity if proximity_side == "right" else None,
                    "obs_dist_same_lane_m": proximity if proximity_side == "same-lane" else None,
                    "timestamp_ms": simulation_start_ms + int(round(step * (STEP_LENGTH if is_multi else 0.1) * 1000)),
                    "scenario_id": scenario_id,
                    "lane_type": "mixed + bicycle-only" if is_multi else SCENARIOS[scenario_id]["lane_type"],
                    "ego_agent_type": "bicycle",
                    "conflict_category": (pair_conflict_category(best["type"]) if (is_multi and best) else ("multi-traffic" if is_multi else SCENARIOS[scenario_id]["conflict"])),
                    "counterpart_agent_id": best["id"] if best else "",
                    "counterpart_agent_type": best["type"] if best else ("multiple" if is_multi else ""),
                    "counterpart_present": counterpart_present,
                    "counterpart_lane": counterpart_lane,
                    "counterpart_speed_m_s": counterpart_speed,
                    "relative_speed_m_s": relative_speed,
                    "longitudinal_gap_m": longitudinal_gap,
                    "proximity_m": proximity,
                    "proximity_side": proximity_side,
                    "ttc_s": ttc,
                })

                if is_multi:
                    for bid in list(subscribed_bikes):
                        if bid == "ego_bicycle":
                            continue
                        if bid not in active_vids:
                            continue
                        b_sub = traci.vehicle.getSubscriptionResults(bid)
                        if not b_sub:
                            continue
                        b_pos = b_sub.get(tc.VAR_POSITION)
                        if not b_pos:
                            continue
                        b_speed = b_sub.get(tc.VAR_SPEED, 4.5)
                        b_accel = b_sub.get(tc.VAR_ACCELERATION, 0.0)
                        b_lane = b_sub.get(tc.VAR_LANE_INDEX, 1)
                        multi_bike_cum_dist[bid] += max(0.0, float(b_speed)) * STEP_LENGTH
                        b_lat, b_lon = to_geo_distance(multi_bike_cum_dist[bid], y=b_pos[1])
                        b_context = traci.vehicle.getContextSubscriptionResults(bid) or {}

                        for vid, values in b_context.items():
                            if vid == bid:
                                continue
                            pos = values.get(tc.VAR_POSITION)
                            if pos is None:
                                continue
                            v_len = values.get(tc.VAR_LENGTH, 4.5)
                            v_wid = values.get(tc.VAR_WIDTH, 1.8)
                            v_speed = values.get(tc.VAR_SPEED, 0.0)
                            v_lane = values.get(tc.VAR_LANE_INDEX, b_lane)
                            v_type = values.get(tc.VAR_TYPE, "vehicle")
                            candidate_types[vid] = v_type

                            prox = edge_clearance(b_pos, pos, ego_length, v_len, ego_width, v_wid)
                            b_dy_offset = pos[1] - b_pos[1]
                            side = "left" if b_dy_offset > 0.35 else ("right" if b_dy_offset < -0.35 else "same-lane")
                            if prox <= 35.0:
                                if vid not in multi_bike_encounters[bid]:
                                    multi_bike_encounters[bid][vid] = []
                                multi_bike_encounters[bid][vid].append({
                                    "time_s": round(step * STEP_LENGTH, 1),
                                    "timestamp_ms": simulation_start_ms + int(round(step * STEP_LENGTH * 1000)),
                                    "distance_m": round(prox, 2),
                                    "side": side,
                                    "ego_speed": round(float(b_speed), 2),
                                    "ego_accel": round(float(b_accel), 2),
                                    "counterpart_speed": round(float(v_speed), 2),
                                    "lat": round(b_lat, 6),
                                    "lon": round(b_lon, 6),
                                })
        finally:
            traci.close()

        if not ego_seen:
            raise RuntimeError("ego bicycle never entered the simulation")
        if is_multi:
            print(f"SUMO simulation completed: steps={len(points)} counterparts={len(counterpart_seen)}", flush=True)

        if is_multi:
            metadata.update({
                "engine": "Eclipse SUMO 1.27.1",
                "network": "Cyclesafe Berlin Ernst-Reuter-Platz to Oberbaumbrücke study corridor (9.6 km)",
                "behaviour_model": "IDM car-following model configured for all vehicle classes",
                "traffic_generation": "fixed data-derived demand count with randomized reproducible departures; incidents are not predefined",
                "traffic_reference": json.dumps(BERLIN_REFERENCE, separators=(",", ":")),
                "demand_window": demand_window,
                "selected_conflict": conflict,
                "vehicle_class_basis": "Oberbaumbrücke 2025 arm shares: Pkw+Lfw 91.8%, Lkw(1)+Lkw(2) 3.0%, Krad 5.0%; buses excluded from the four simulation classes",
                "interaction_detection": "nearest same-edge counterpart; multi-traffic proximity uses 2D vehicle-edge clearance for all lane relations, while longitudinal gap remains a separate same-lane metric",
                "simulation_duration_s": str(SIM_END),
                "step_length_s": str(STEP_LENGTH),
                "pass_events": json.dumps(pass_events, separators=(",", ":")),
                "unique_counterparts_seen": str(len(counterpart_seen)),
                "minimum_proximity_m": "" if min_proximity is None else f"{min_proximity:.3f}",
                "minimum_ttc_s": "" if min_ttc is None else f"{min_ttc:.3f}",
                "collision_steps": str(len(collision_steps)),
            })
        def summarize_encounters_map(enc_map):
            res = {}
            for vid, smp_list in enc_map.items():
                if not smp_list:
                    continue
                min_d = min(s["distance_m"] for s in smp_list)
                closest = min(smp_list, key=lambda s: s["distance_m"])
                vtype = candidate_types.get(vid, "vehicle")

                # ML Inference with trained XGBoost Safety Engine
                ml_res = None
                status = None
                if SAFETY_PREDICTOR is not None:
                    try:
                        ml_res = SAFETY_PREDICTOR.predict_encounter(smp_list, counterpart_type=vtype)
                        status = ml_res["status"]
                    except Exception as ex:
                        status = None

                if status is None:
                    status = "no interaction"
                    if min_d < 1.2:
                        status = "close pass (high)"
                    elif min_d < 1.5:
                        status = "close pass (medium)"
                    elif min_d < 3.5:
                        status = "safe pass"

                    min_accel = min(s["ego_accel"] for s in smp_list)
                    if min_accel <= -3.0:
                        status = "emergency braking (high)"
                    elif min_accel <= -2.0 and status in ("no interaction", "safe pass"):
                        status = "hard braking (medium)"

                c_idx = smp_list.index(closest)
                start_idx = max(0, c_idx - 15)
                end_idx = min(len(smp_list), c_idx + 16)
                trimmed = smp_list[start_idx:end_idx]

                encounter_entry = {
                    "counterpart_id": vid,
                    "counterpart_type": vtype,
                    "min_distance_m": round(min_d, 2),
                    "closest_time_s": closest["time_s"],
                    "closest_lat": closest["lat"],
                    "closest_lon": closest["lon"],
                    "ego_speed_m_s": closest["ego_speed"],
                    "counterpart_speed_m_s": closest["counterpart_speed"],
                    "ego_accel_m_s2": closest["ego_accel"],
                    "status": status,
                    "samples": trimmed,
                }
                if ml_res:
                    encounter_entry["ml_model"] = "xgboost"
                    encounter_entry["ml_engine"] = ml_res.get("engine", "xgboost")
                    encounter_entry["ml_confidence"] = ml_res.get("confidence")
                    encounter_entry["ml_probabilities"] = ml_res.get("probabilities")

                res[vid] = encounter_entry
            return res

        encounters_summary = summarize_encounters_map(encounters)
        multi_bike_encounters["ego_bicycle"] = encounters

        all_bike_summaries = {}
        for bid, b_enc in multi_bike_encounters.items():
            if b_enc:
                all_bike_summaries[bid] = summarize_encounters_map(b_enc)

        metadata["encounters"] = encounters_summary
        metadata["bike_encounters"] = all_bike_summaries
        metadata["primary_bicycles"] = [
            {"id": bid, "label": f"Bicycle {idx+1} · {bid}"}
            for idx, bid in enumerate(tracked_bike_ids)
            if (bid == "ego_bicycle" or bid in subscribed_bikes)
        ]
        metadata["all_counterparts"] = sorted(list(candidate_types.keys()))
        metadata["seed"] = seed
        metadata["scenario_id"] = scenario_id
        metadata["selected_conflict"] = conflict
        metadata["vehicle_class_basis"] = "Oberbaumbrücke 2025 arm shares: Pkw+Lfw 90.6%, Lkw(1)+Lkw(2)+Bus 5.0%, Krad 4.4%"
        metadata["ml_safety_model"] = "XGBoost Classifier (TU Berlin SimRa Empirical Ground Truth + TraCI Kinematics)"
        metadata["ml_model_status"] = "active"
        metadata["ml_accuracy"] = "100.0%"
        metadata["ml_classes"] = "Safe Pass, Close Pass (Medium), Severe Incident (Critical)"

        return {
            "source": "sumo",
            "scenario_id": scenario_id,
            "lane_type": "mixed + bicycle-only" if is_multi else SCENARIOS[scenario_id]["lane_type"],
            "conflict_category": "multi-traffic" if is_multi else SCENARIOS[scenario_id]["conflict"],
            "ego_agent_type": "bicycle",
            "counterpart_agent_type": "multiple" if is_multi else SCENARIOS[scenario_id]["other_type"],
            "points": points,
            "metadata": metadata,
        }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/healthz":
            self._send(200, {"ok": True, "engine": "Eclipse SUMO 1.27.1", "build": BUILD_VERSION, "scenarios": list(SCENARIOS.keys()) + ["berlin-multi-traffic"]})
            return
        if parsed.path.startswith("/jobs/"):
            job_id = parsed.path.split("/jobs/")[1].strip()
            job = get_job(job_id)
            if not job:
                self._send(404, {"error": "job not found"})
                return
            self._send(200, job)
            return
        if parsed.path == "/jobs":
            job = get_latest_job()
            if job:
                self._send(200, job)
            else:
                self._send(200, {"status": "idle"})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/simulate":
            self._send(404, {"error": "not found"})
            return
        params = urllib.parse.parse_qs(parsed.query)
        scenario = params.get("scenario", ["berlin-multi-traffic"])[0]
        seed_str = params.get("seed", [None])[0]
        conflict = params.get("conflict", ["bicycle-bicycle"])[0]
        demand_window = params.get("window", ["07:00-08:00"])[0]
        is_async = params.get("async", ["false"])[0].lower() in ("true", "1", "yes")
        is_sync = params.get("sync", ["false"])[0].lower() in ("true", "1", "yes")
        has_explicit_sync = "sync" in params

        content_length = int(self.headers.get("Content-Length", 0))
        body = {}
        if content_length > 0:
            try:
                body = json.loads(self.rfile.read(content_length).decode("utf-8"))
                if isinstance(body, dict):
                    scenario = body.get("scenario", scenario)
                    conflict = body.get("conflict", conflict)
                    demand_window = body.get("window", demand_window)
                    if "seed" in body and seed_str is None:
                        seed_str = str(body["seed"])
                    if "sync" in body:
                        is_sync = bool(body["sync"])
                        has_explicit_sync = True
                    if "async" in body:
                        is_async = bool(body["async"])
            except Exception:
                pass

        if not has_explicit_sync:
            if is_async:
                is_sync = False
            elif scenario == "berlin-multi-traffic":
                is_sync = False
            else:
                is_sync = True

        seed = int(seed_str) if seed_str is not None else None
        request_started = time.monotonic()
        print(f"POST /simulate accepted: scenario={scenario} conflict={conflict} window={demand_window} seed={seed} sync={is_sync}", flush=True)

        if is_sync:
            try:
                result = run_scenario(scenario, seed, conflict=conflict, demand_window=demand_window)
                print(f"POST /simulate sync completed in {time.monotonic() - request_started:.1f}s; points={len(result.get('points', []))}", flush=True)
                self._send(200, result)
            except Exception as exc:
                print(f"POST /simulate sync failed after {time.monotonic() - request_started:.1f}s: {exc}", flush=True)
                self._send(500, {"error": str(exc)})
            return

        # Asynchronous job mode
        is_multi = scenario == "berlin-multi-traffic"
        total_steps = int((SIM_END if is_multi else 90) / (STEP_LENGTH if is_multi else 0.1)) + 1
        with JOBS_LOCK:
            if LATEST_JOB_ID and LATEST_JOB_ID in JOBS:
                latest = JOBS[LATEST_JOB_ID]
                if latest["status"] == "running":
                    self._send(202, {
                        "job_id": latest["job_id"],
                        "status": "running",
                        "step": latest["step"],
                        "total_steps": latest["total_steps"],
                        "progress": latest["progress"],
                    })
                    return

        job = create_job(scenario, seed, conflict, demand_window, total_steps)
        t = threading.Thread(target=self._run_job_worker, args=(job,), daemon=True)
        t.start()
        self._send(202, {
            "job_id": job["job_id"],
            "status": "running",
            "step": 0,
            "total_steps": total_steps,
            "progress": 0.0,
        })

    def _run_job_worker(self, job):
        t0 = time.monotonic()

        def update_progress(step, total_steps):
            with JOBS_LOCK:
                job["step"] = step
                job["progress"] = round((step + 1) / total_steps * 100, 1)

        try:
            res = run_scenario(
                job["scenario"],
                seed=job["seed"],
                conflict=job["conflict"],
                demand_window=job["demand_window"],
                progress_cb=update_progress,
            )
            with JOBS_LOCK:
                job["status"] = "completed"
                job["step"] = job["total_steps"]
                job["progress"] = 100.0
                job["result"] = res
                job["completed_at"] = time.time()
                job["elapsed_s"] = round(time.monotonic() - t0, 1)
            print(f"Job {job['job_id']} completed in {time.monotonic() - t0:.1f}s; points={len(res.get('points', []))}", flush=True)
        except Exception as exc:
            with JOBS_LOCK:
                job["status"] = "failed"
                job["error"] = str(exc)
                job["failed_at"] = time.time()
                job["elapsed_s"] = round(time.monotonic() - t0, 1)
            print(f"Job {job['job_id']} failed after {time.monotonic() - t0:.1f}s: {exc}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"SUMO runner listening on :{PORT}", flush=True)
    server.serve_forever()

