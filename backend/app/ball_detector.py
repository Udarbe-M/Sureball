from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional

import numpy as np
from ultralytics import YOLO


class BallDetector:
    TRAINING_LABEL_PATTERNS = {
        "ball": {"sports ball", "basketball", "ball"},
        "ball_in_basket": {"ball in basket", "ball_in_basket"},
        "player": {"player", "person"},
        "basket": {"basket", "hoop", "rim"},
        "player_shooting": {"player shooting", "player_shooting"},
    }

    def __init__(self, model_path: Optional[str] = None) -> None:
        backend_dir = Path(__file__).resolve().parents[1]
        models_dir = backend_dir / "models"
        configured_model = os.getenv("BALL_DETECTOR_MODEL")
        candidate_paths = [
            models_dir / "basketball_detection_yolo11s.pt",
            models_dir / "yolo11n.pt",
            backend_dir / "yolo11n.pt",
        ]
        default_model_path = next((path for path in candidate_paths if path.exists()), None)
        resolved_model = model_path or configured_model or (
            str(default_model_path) if default_model_path is not None else "yolo11n.pt"
        )
        self.model: Optional[YOLO] = None
        self.model_source = resolved_model
        self.ready = False
        try:
            self.model = YOLO(resolved_model)
            self.class_name_lookup = self._build_class_name_lookup()
            self.training_class_ids = self._find_training_class_ids()
            self.ball_class_ids = self._find_ball_class_ids()
            self.ready = True
        except Exception:
            self.class_name_lookup = {}
            self.training_class_ids = {}
            self.ball_class_ids = set()

    def _build_class_name_lookup(self) -> Dict[int, str]:
        if self.model is None:
            return {}
        return {
            int(class_id): self._normalize_label(name)
            for class_id, name in self.model.names.items()
        }

    @staticmethod
    def _normalize_label(name: object) -> str:
        return str(name).strip().lower().replace("_", " ").replace("-", " ")

    def _find_ball_class_ids(self) -> set[int]:
        class_ids = set()
        for class_id, normalized in self.class_name_lookup.items():
            if normalized in {"sports ball", "basketball", "ball"}:
                class_ids.add(int(class_id))
        return class_ids

    def _find_training_class_ids(self) -> Dict[str, set[int]]:
        class_ids = {label: set() for label in self.TRAINING_LABEL_PATTERNS}
        for class_id, normalized in self.class_name_lookup.items():
            for label, aliases in self.TRAINING_LABEL_PATTERNS.items():
                if normalized in aliases:
                    class_ids[label].add(class_id)
        return class_ids

    def supports_shot_training(self) -> bool:
        required_labels = ("ball_in_basket", "basket", "player_shooting")
        return all(self.training_class_ids.get(label) for label in required_labels)

    def detect(self, frame: np.ndarray) -> Optional[Dict[str, float]]:
        if self.model is None:
            return None
        results = self.model.predict(source=frame, verbose=False, conf=0.25)
        if not results:
            return None

        boxes = results[0].boxes
        if boxes is None:
            return None

        best_match: Optional[Dict[str, float]] = None
        for box in boxes:
            class_id = int(box.cls.item())
            if class_id not in self.ball_class_ids:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            confidence = float(box.conf.item())
            candidate = {
                "x1": float(x1),
                "y1": float(y1),
                "x2": float(x2),
                "y2": float(y2),
                "confidence": confidence,
                "label": "basketball",
            }
            if best_match is None or confidence > best_match["confidence"]:
                best_match = candidate

        return best_match

    def detect_training_objects(
        self,
        frame: np.ndarray,
        confidence_overrides: Optional[Dict[str, float]] = None,
    ) -> list[Dict[str, float | str]]:
        if self.model is None:
            return []

        thresholds = {
            "ball": 0.5,
            "ball_in_basket": 0.25,
            "player": 0.45,
            "basket": 0.45,
            "player_shooting": 0.5,
        }
        if confidence_overrides:
            thresholds.update(confidence_overrides)

        min_confidence = min(thresholds.values()) if thresholds else 0.25
        results = self.model.predict(source=frame, verbose=False, conf=min_confidence)
        if not results:
            return []

        boxes = results[0].boxes
        if boxes is None:
            return []

        detections: list[Dict[str, float | str]] = []
        for box in boxes:
            class_id = int(box.cls.item())
            confidence = float(box.conf.item())
            normalized_name = self.class_name_lookup.get(class_id)
            if normalized_name is None:
                continue

            matched_label = None
            for label, aliases in self.TRAINING_LABEL_PATTERNS.items():
                if normalized_name in aliases:
                    matched_label = label
                    break

            if matched_label is None or confidence < thresholds.get(matched_label, 0.25):
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(
                {
                    "x1": float(x1),
                    "y1": float(y1),
                    "x2": float(x2),
                    "y2": float(y2),
                    "confidence": confidence,
                    "label": matched_label,
                    "display_label": normalized_name.title(),
                }
            )

        return detections
