from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

import numpy as np
from ultralytics import YOLO


class BallDetector:
    def __init__(self, model_path: Optional[str] = None) -> None:
        default_model_path = Path(__file__).resolve().parents[1] / "models" / "yolo11n.pt"
        resolved_model = model_path or (str(default_model_path) if default_model_path.exists() else "yolo11n.pt")
        self.model: Optional[YOLO] = None
        self.model_source = resolved_model
        self.ready = False
        try:
            self.model = YOLO(resolved_model)
            self.ball_class_ids = self._find_ball_class_ids()
            self.ready = True
        except Exception:
            self.ball_class_ids = set()

    def _find_ball_class_ids(self) -> set[int]:
        if self.model is None:
            return set()
        names = self.model.names
        class_ids = set()
        for class_id, name in names.items():
            normalized = str(name).strip().lower()
            if normalized in {"sports ball", "basketball", "ball"}:
                class_ids.add(int(class_id))
        return class_ids

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
