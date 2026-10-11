# CycleSafe ML Safety Engine — Methodology & Evaluation Report

## 1. Overview
The CycleSafe Machine Learning Safety Engine is a multi-class XGBoost classifier designed to categorize vehicle-bicycle interaction encounters into 3 risk levels:
- **Class 0 — Safe Pass**: Adequate lateral clearance (≥ 1.50 m) maintained per German StVO § 5(4).
- **Class 1 — Close Pass (Medium Conflict)**: Lateral clearance between 1.05 m and 1.49 m, or moderate evasive deceleration.
- **Class 2 — Severe Incident (Critical Conflict)**: Critical lateral clearance (< 1.02 m), emergency braking (≤ -2.5 m/s²), or critical time-to-collision (TTC < 1.5 s).

---

## 2. Model Architecture & Features
- **Model Type**: XGBoost Gradient Boosted Decision Trees (`XGBClassifier`)
- **Objective**: Multi-class soft probability (`multi:softprob`), 3 classes
- **Input Features**:
  1. `lateral_clearance_m`: 2D vehicle-edge clearance (Feature Importance: **47.0%**)
  2. `time_to_collision_s`: Longitudinal / lateral trajectory projection time-to-collision (**24.4%**)
  3. `min_deceleration_m_s2`: Peak ego bicycle deceleration during encounter (**20.7%**)
  4. `ego_speed_m_s`: Bicycle velocity (**2.8%**)
  5. `counterpart_speed_m_s`: Interacting vehicle velocity (**2.6%**)
  6. `counterpart_type_encoded`: Vehicle category (car=1, truck/bus=2, motorcycle=3, bike=0) (**1.6%**)
  7. `relative_speed_m_s`: Absolute speed differential (**1.0%**)

---

## 3. Investigation of 100% Test Accuracy (Synthetic Label Leakage)

### 3.1 The Finding
During initial training and validation on an 80/20 train/test stratified split of 1,524 samples, the model achieved **100.0% accuracy** (Macro F1 = 1.0, 0 classification errors across 305 test samples).

### 3.2 Root Cause Analysis
Code inspection of `ml/train_xgboost.py` revealed that training labels were generated using non-overlapping kinematic thresholds:
```python
if regime == 0:    # Safe
    clearance = rng.uniform(1.52, 3.80)
    label = 0
elif regime == 1:  # Close Pass
    clearance = rng.uniform(1.05, 1.49)
    label = 1
else:              # Severe Incident
    clearance = rng.uniform(0.40, 1.02)
    label = 2
```
Because the feature ranges for `lateral_clearance_m` were partitioned into disjoint intervals (`[0.40, 1.02]`, `[1.05, 1.49]`, `[1.52, 3.80]`), the decision tree ensemble was able to achieve zero training and test error by simply learning tree cut points at `lateral_clearance_m = 1.035` and `1.505`.

### 3.3 Scientific Scope & Limitations
- **What this measures**: The test partition verifies that the decision tree ensemble **successfully internalizes the deterministic surrogate conflict rules** defined by German traffic law (StVO § 5(4)).
- **What this does NOT measure**: This does **NOT** measure independent predictive validity on real-world subjective human risk perception.
- **Reporting Rule**: The application and metadata must never present this 100% test agreement as "100% real-world incident prediction accuracy". It represents surrogate-threshold rule boundary convergence.

---

## 4. Real-World Ground Truth Integration
- SimRa (TU Berlin) crowdsourced ride traces were parsed from real smartphone accelerometers in Berlin.
- While SimRa traces provide real accelerometer dynamics, smartphone GPS sensors lack continuous lateral LiDAR/radar distance tracking.
- Lateral clearance in mixed traffic requires ultrasonic sensor hardware or calibrated microscopic simulation telemetry (SUMO TraCI).
