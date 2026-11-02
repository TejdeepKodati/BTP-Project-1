"""
CycleSafe Production Inference Engine for XGBoost
Provides high-performance inference for vehicle-bicycle encounter classifications.
Supports dual backend:
1. Native `xgboost.Booster` when xgboost is installed.
2. Built-in Pure-Python Tree Ensemble evaluator directly parsing `xgboost_safety_model.json`
   (ensures 100% zero-dependency execution anywhere, including minimal containers).
"""

import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

TYPE_MAPPING = {
    "bike": 0,
    "bicycle": 0,
    "car": 1,
    "car_moderate": 1,
    "car_lane2_right": 1,
    "passenger": 1,
    "delivery": 1,
    "taxi": 1,
    "truck": 2,
    "lorry": 2,
    "bus": 2,
    "heavy": 2,
    "motorcycle": 3,
    "motorbike": 3,
    "moto": 3,
    "moto_moderate": 3,
    "vehicle": 1,
    "multiple": 1,
}

CLASS_LABELS = {
    0: "safe pass",
    1: "close pass (medium)",
    2: "close pass (high)",
}

FEATURE_NAMES = [
    "lateral_clearance_m",
    "relative_speed_m_s",
    "ego_speed_m_s",
    "counterpart_speed_m_s",
    "min_deceleration_m_s2",
    "time_to_collision_s",
    "counterpart_type_encoded",
]


class TreeModelParser:
    """Zero-dependency pure-Python JSON tree evaluator for XGBoost models."""

    def __init__(self, model_json: Dict):
        self.num_classes = 3
        self.trees = []
        learner = model_json.get("learner", {})
        gb_model = learner.get("gradient_booster", {}).get("model", {})
        trees_raw = gb_model.get("trees", [])
        tree_info = gb_model.get("tree_info", [])

        for idx, t in enumerate(trees_raw):
            cls_target = tree_info[idx] if idx < len(tree_info) else (idx % self.num_classes)
            self.trees.append({
                "class": cls_target,
                "split_indices": t.get("split_indices", []),
                "split_conditions": t.get("split_conditions", []),
                "left_children": t.get("left_children", []),
                "right_children": t.get("right_children", []),
                "base_weights": t.get("base_weights", []),
                "loss_changes": t.get("loss_changes", []),
            })

    def eval_tree(self, tree: Dict, features: List[float]) -> float:
        node = 0
        left = tree["left_children"]
        right = tree["right_children"]
        split_idx = tree["split_indices"]
        split_val = tree["split_conditions"]
        weights = tree["base_weights"]

        while left[node] != -1:
            feat_idx = split_idx[node]
            f_val = features[feat_idx] if feat_idx < len(features) else 0.0
            if f_val < split_val[node]:
                node = left[node]
            else:
                node = right[node]
        return weights[node]

    def predict_proba(self, features: List[float]) -> List[float]:
        raw_scores = [0.0] * self.num_classes
        for tree in self.trees:
            c = tree["class"]
            val = self.eval_tree(tree, features)
            raw_scores[c] += val

        # Softmax normalization
        max_s = max(raw_scores)
        exp_s = [math.exp(s - max_s) for s in raw_scores]
        sum_exp = sum(exp_s)
        return [round(s / sum_exp, 4) for s in exp_s]


class SafetyPredictor:
    def __init__(self, model_path: Optional[Union[str, Path]] = None):
        if model_path is None:
            # Look in ml/ and sumo/
            candidates = [
                Path(__file__).resolve().parent / "xgboost_safety_model.json",
                Path(__file__).resolve().parent.parent / "sumo" / "xgboost_safety_model.json",
                Path("/app/xgboost_safety_model.json"),
                Path("xgboost_safety_model.json"),
            ]
            for c in candidates:
                if c.exists():
                    model_path = c
                    break

        if model_path is None or not Path(model_path).exists():
            raise FileNotFoundError(f"XGBoost safety model not found at {model_path}")

        self.model_path = Path(model_path)
        with open(self.model_path, "r", encoding="utf-8") as f:
            self.model_data = json.load(f)

        self.native_booster = None
        try:
            import xgboost as xgb
            self.native_booster = xgb.Booster()
            self.native_booster.load_model(str(self.model_path))
            self.engine_type = f"native-xgboost-{xgb.__version__}"
        except Exception:
            self.engine_type = "pure-python-xgboost-tree-engine"

        self.tree_parser = TreeModelParser(self.model_data)

    def predict(
        self,
        lateral_clearance_m: float,
        relative_speed_m_s: float,
        ego_speed_m_s: float,
        counterpart_speed_m_s: float,
        min_deceleration_m_s2: float,
        time_to_collision_s: float,
        counterpart_type: str = "car",
    ) -> Dict:
        """Runs inference on a single encounter kinematic vector."""
        vtype_encoded = TYPE_MAPPING.get(counterpart_type.lower(), 1)
        features = [
            float(lateral_clearance_m),
            float(relative_speed_m_s),
            float(ego_speed_m_s),
            float(counterpart_speed_m_s),
            float(min_deceleration_m_s2),
            float(time_to_collision_s),
            float(vtype_encoded),
        ]

        if self.native_booster is not None:
            import xgboost as xgb
            dmat = xgb.DMatrix([features], feature_names=FEATURE_NAMES)
            probs = self.native_booster.predict(dmat)[0].tolist()
            probs = [round(float(p), 4) for p in probs]
        else:
            probs = self.tree_parser.predict_proba(features)

        pred_class = int(max(range(len(probs)), key=lambda i: probs[i]))
        confidence = probs[pred_class]

        # Determine semantic status
        if pred_class == 0:
            status = "safe pass"
        elif pred_class == 1:
            if min_deceleration_m_s2 <= -2.0 and lateral_clearance_m >= 1.5:
                status = "hard braking (medium)"
            else:
                status = "close pass (medium)"
        else:  # pred_class == 2
            if min_deceleration_m_s2 <= -2.8 and lateral_clearance_m >= 1.2:
                status = "emergency braking (high)"
            else:
                status = "close pass (high)"

        return {
            "status": status,
            "predicted_class": pred_class,
            "confidence": confidence,
            "probabilities": {
                "safe": probs[0],
                "medium": probs[1],
                "severe": probs[2],
            },
            "engine": self.engine_type,
        }

    def predict_encounter(self, samples: List[Dict], counterpart_type: str = "vehicle") -> Dict:
        """
        Extracts key metrics from an encounter trajectory sample list and evaluates safety.
        """
        if not samples:
            return {
                "status": "no interaction",
                "predicted_class": 0,
                "confidence": 1.0,
                "probabilities": {"safe": 1.0, "medium": 0.0, "severe": 0.0},
                "engine": self.engine_type,
            }

        min_d = min(s["distance_m"] for s in samples)
        closest = min(samples, key=lambda s: s["distance_m"])
        min_accel = min(s["ego_accel"] for s in samples)

        v_ego = float(closest["ego_speed"])
        v_other = float(closest["counterpart_speed"])
        rel_spd = abs(v_other - v_ego)
        ttc = min_d / max(0.1, rel_spd)

        return self.predict(
            lateral_clearance_m=min_d,
            relative_speed_m_s=rel_spd,
            ego_speed_m_s=v_ego,
            counterpart_speed_m_s=v_other,
            min_deceleration_m_s2=min_accel,
            time_to_collision_s=ttc,
            counterpart_type=counterpart_type,
        )


if __name__ == "__main__":
    predictor = SafetyPredictor()
    print(f"Loaded SafetyPredictor using engine: {predictor.engine_type}")

    # Test cases
    test_cases = [
        {"clearance": 2.1, "rel_spd": 4.0, "ego_spd": 5.0, "other_spd": 9.0, "decel": -0.2, "ttc": 5.0, "type": "car"},
        {"clearance": 1.3, "rel_spd": 6.0, "ego_spd": 4.5, "other_spd": 10.5, "decel": -1.2, "ttc": 2.2, "type": "car"},
        {"clearance": 0.75, "rel_spd": 8.0, "ego_spd": 4.0, "other_spd": 12.0, "decel": -3.5, "ttc": 0.8, "type": "truck"},
    ]

    for tc in test_cases:
        res = predictor.predict(
            tc["clearance"], tc["rel_spd"], tc["ego_spd"], tc["other_spd"], tc["decel"], tc["ttc"], tc["type"]
        )
        print(f"Test {tc['clearance']}m with {tc['type']} -> Status: {res['status']}, Conf: {res['confidence']:.2f}, Probs: {res['probabilities']}")
