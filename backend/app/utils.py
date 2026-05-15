from __future__ import annotations

import base64
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import cv2
import numpy as np


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
SESSION_HISTORY_PATH = DATA_DIR / "session_history.json"

LANDMARK_NAMES = {
    0: "nose",
    11: "left_shoulder",
    12: "right_shoulder",
    13: "left_elbow",
    14: "right_elbow",
    15: "left_wrist",
    16: "right_wrist",
    23: "left_hip",
    24: "right_hip",
    25: "left_knee",
    26: "right_knee",
    27: "left_ankle",
    28: "right_ankle",
    31: "left_foot_index",
    32: "right_foot_index",
}


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SESSION_HISTORY_PATH.exists():
        SESSION_HISTORY_PATH.write_text("[]", encoding="utf-8")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_session_id() -> str:
    return uuid.uuid4().hex


def midpoint(a: Dict[str, float], b: Dict[str, float]) -> Dict[str, float]:
    return {"x": (a["x"] + b["x"]) / 2.0, "y": (a["y"] + b["y"]) / 2.0}


def distance(a: Dict[str, float], b: Dict[str, float]) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def angle(a: Dict[str, float], b: Dict[str, float], c: Dict[str, float]) -> float:
    ba = np.array([a["x"] - b["x"], a["y"] - b["y"]], dtype=float)
    bc = np.array([c["x"] - b["x"], c["y"] - b["y"]], dtype=float)
    norm_product = float(np.linalg.norm(ba) * np.linalg.norm(bc))
    if norm_product == 0:
        return 0.0
    cosine = float(np.clip(np.dot(ba, bc) / norm_product, -1.0, 1.0))
    return math.degrees(math.acos(cosine))


def vertical_angle(a: Dict[str, float], b: Dict[str, float]) -> float:
    vector = np.array([b["x"] - a["x"], b["y"] - a["y"]], dtype=float)
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        return 0.0
    vertical = np.array([0.0, -1.0], dtype=float)
    cosine = float(np.clip(np.dot(vector, vertical) / norm, -1.0, 1.0))
    return math.degrees(math.acos(cosine))


def safe_ratio(value: float, divisor: float) -> float:
    if divisor == 0:
        return 0.0
    return value / divisor


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def mean(values: Iterable[float]) -> float:
    values = list(values)
    if not values:
        return 0.0
    return float(sum(values) / len(values))


def frame_to_base64(frame: np.ndarray) -> str:
    success, buffer = cv2.imencode(".jpg", frame)
    if not success:
        return ""
    return base64.b64encode(buffer.tobytes()).decode("utf-8")


def decode_image_bytes(data: bytes) -> np.ndarray:
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode image bytes.")
    return image


def normalize_point(x: float, y: float, width: int, height: int, visibility: float) -> Dict[str, float]:
    return {
        "x": x * width,
        "y": y * height,
        "visibility": visibility,
    }


def filter_landmarks(landmarks: List[Dict[str, float]], min_visibility: float = 0.35) -> Dict[str, Dict[str, float]]:
    filtered: Dict[str, Dict[str, float]] = {}
    for index, point in enumerate(landmarks):
        name = LANDMARK_NAMES.get(index)
        if not name or point["visibility"] < min_visibility:
            continue
        filtered[name] = point
    return filtered


def draw_text_block(frame: np.ndarray, lines: List[str], origin: Tuple[int, int] = (16, 24)) -> np.ndarray:
    x, y = origin
    for line in lines:
        cv2.putText(
            frame,
            line,
            (x, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        y += 24
    return frame


def append_session_history(record: Dict[str, object]) -> None:
    ensure_data_dir()
    history = load_session_history()
    history.append(record)
    SESSION_HISTORY_PATH.write_text(json.dumps(history, indent=2, default=str), encoding="utf-8")


def load_session_history() -> List[Dict[str, object]]:
    ensure_data_dir()
    raw = SESSION_HISTORY_PATH.read_text(encoding="utf-8").strip()
    if not raw:
        return []
    return json.loads(raw)


def delete_session_history_record(session_id: str) -> bool:
    ensure_data_dir()
    history = load_session_history()
    updated_history = [record for record in history if str(record.get("session_id")) != session_id]
    if len(updated_history) == len(history):
        return False
    SESSION_HISTORY_PATH.write_text(json.dumps(updated_history, indent=2, default=str), encoding="utf-8")
    return True


def select_shooting_side(landmarks: Dict[str, Dict[str, float]], ball_center: Optional[Dict[str, float]]) -> str:
    if ball_center and "left_wrist" in landmarks and "right_wrist" in landmarks:
        left_dist = distance(landmarks["left_wrist"], ball_center)
        right_dist = distance(landmarks["right_wrist"], ball_center)
        return "left" if left_dist <= right_dist else "right"
    left_visibility = landmarks.get("left_wrist", {}).get("visibility", 0.0)
    right_visibility = landmarks.get("right_wrist", {}).get("visibility", 0.0)
    return "left" if left_visibility >= right_visibility else "right"


def ball_center_from_box(box: Optional[Dict[str, float]]) -> Optional[Dict[str, float]]:
    if not box:
        return None
    return {"x": (box["x1"] + box["x2"]) / 2.0, "y": (box["y1"] + box["y2"]) / 2.0}
