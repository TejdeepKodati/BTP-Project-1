# SUMO simulation layer

This directory contains the actual Eclipse SUMO + TraCI simulation layer used
by the Road network scenarios.

## Network

- `nodes.nod.xml` and `edges.edg.xml` define a controlled Berlin-anchored
  right-hand-traffic corridor.
- Each direction has three lanes in SUMO lane order; the two mixed lanes are 2.6 m wide in this controlled urban-style corridor:
  - lane 0: bicycle-only
  - lane 1: mixed traffic
  - lane 2: mixed traffic / left-side passing lane
- `netconvert` builds `network.net.xml` inside the SUMO Docker image.
- The geometry is intentionally controlled and reproducible. It is **not yet
  an OpenStreetMap import**.

## Interaction scenarios

The four scenarios requested for the project are implemented as reproducible
SUMO simulations:

1. bicycle-bicycle on the bicycle-only lane
2. bicycle-car on the mixed lanes
3. bicycle-motorbike on the mixed lanes
4. bicycle-heavy-duty on the mixed lanes

For motor-vehicle scenarios, the counterpart starts behind the ego bicycle in
the adjacent left mixed lane and passes while remaining in that lane. No
lane change into the bicycle lane is scripted. Pass start/completion are
detected from the two vehicles' longitudinal positions.

## Telemetry bridge

`runner.py` advances SUMO with TraCI and extracts:

- ego bicycle position, speed and longitudinal acceleration
- counterpart presence and lane
- longitudinal relation and bumper-to-bumper gap from TraCI lane positions
- simulation-derived 2D vehicle-edge proximity
- relative speed and time-to-collision when the counterpart is behind and
  closing

The runner converts the result to the existing SimRa-shaped telemetry
contract. The Go backend then stores it, applies the existing rule-based
incident detector, and serves it to the dashboard.

## Important scope boundary

SUMO-derived acceleration/proximity values are simulation outputs. They are not
being presented as measurements from the future Arduino/IMU/proximity hardware.
Likewise, the controlled corridor is a validation network, not a surveyed
German street network. The next expansion is OSM import, followed by richer
traffic demand, junctions, and calibration against real observations.


### Telemetry interpretation
The SUMO runner produces simulation-derived proximity and longitudinal kinematics. Accelerometer and gyroscope fields are placeholders unless a calibrated sensor model is added; they should not be presented as physical IMU measurements.


Validation note: the runner samples SUMO at 0.1 s resolution so short-duration lateral passing interactions are not missed by 1 s sampling.
