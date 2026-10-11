# SUMO road-network integration

The `config.json` file is the application-level contract for the road-network
milestone. The actual traffic simulation is executed by Eclipse SUMO through a
small Python/TraCI runner in `sumo/`.

## Network

- Two directed road edges form an eastbound/westbound corridor.
- Lane index `0` is bicycle-only and permits only the SUMO `bicycle` class.
- Lane index `1` is mixed traffic and permits bicycle, passenger car,
  motorcycle, and truck classes.
- The two directions are explicitly represented, matching right-hand traffic
  semantics.
- The corridor is intentionally controlled and Berlin-anchored so the
  simulation is reproducible before moving to an imported OSM network.

SUMO's vehicle permissions are the enforcement mechanism: vehicles may only use
lanes that permit their vehicle class.

## Scenarios

The four configured scenarios map directly to the project objective:

1. bicycle vs bicycle on the bicycle-only lane
2. bicycle vs car on the mixed lane
3. bicycle vs motorbike on the mixed lane
4. bicycle vs heavy-duty vehicle on the mixed lane

The runner creates the scenario's vehicle demand, starts SUMO, advances the
simulation through TraCI, and observes the ego bicycle. The counterpart is
identified from the configured vehicle ID. Its leader gap becomes the current
simulation proximity signal.

The Go backend converts the returned trajectory to the existing SimRa-shaped
telemetry model, then runs the same storage and rule-based incident detector.
This keeps the dashboard and future hardware ingestion contract unchanged.

## Running

The normal project command is:

```bash
docker compose up -d --build
```

This builds the `sumo-runner` from the official Eclipse SUMO container image,
starts the Go backend, and connects `/api/simulate?scenario=...` to SUMO/TraCI.

For local GUI inspection, install SUMO on Windows and open the generated
`sumocfg`/network files with `sumo-gui`. The GUI is optional for the web
pipeline; the runner uses headless `sumo`.
