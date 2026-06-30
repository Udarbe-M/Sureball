from __future__ import annotations

from typing import Any
from typing import Optional

import cv2
import numpy as np

from .feedback_engine import extract_features, generate_feedback
from .scoring import calculate_score, classify_score
from .schemas import FeedbackCue, FrameAnalysisResponse, ScoreResult
from .utils import frame_to_base64, now_utc


POSE_CONFIDENCE_THRESHOLD = 0.70
POSE_CONFIDENCE_GATED_MODES = {"shooting_form", "dribbling", "passing"}
MIN_CONFIDENT_POSE_LANDMARKS = 6


def run_coaching_analysis(
    frame: np.ndarray,
    *,
    mode: str,
    session_id: str,
    frame_index: int,
    pose_estimator: Any,
    ball_detector: Any,
    landmark_smoother: Any = None,
    timestamp_seconds: Optional[float] = None,
    include_base64: bool = True,
) -> dict[str, Any]:
    pose_result = pose_estimator.detect(frame, smoother=landmark_smoother, timestamp=timestamp_seconds)
    pose_detected = _pose_detected_for_mode(pose_result, mode=mode)
    landmarks = _landmarks_for_mode(pose_result, mode=mode) if pose_detected else {}
    ball_box = ball_detector.detect(frame)
    features = extract_features(mode=mode, landmarks=landmarks, ball_box=ball_box)
    feedback, summary = generate_feedback(mode=mode, features=features, ball_detected=ball_box is not None)
    ball_detected = ball_box is not None

    if not pose_detected:
        feedback.insert(
            0,
            FeedbackCue(
                code="pose_not_detected",
                message="Step fully into frame so your body landmarks can be tracked.",
                severity="high",
                deduction=18,
            ),
        )
    if not pose_detected and not ball_detected:
        feedback.insert(
            0,
            FeedbackCue(
                code="no_valid_basketball_action",
                message="No player or basketball detected. Use a clip where the athlete and ball are clearly visible.",
                severity="high",
                deduction=40,
            ),
        )
    score = calculate_score(feedback)
    score = _cap_invalid_frame_score(
        score,
        mode=mode,
        pose_detected=pose_detected,
        ball_detected=ball_detected,
        features=features,
    )

    drawing_landmarks = pose_result.get("drawing_landmarks") or pose_result["raw_landmarks"]
    annotated = pose_estimator.draw(frame, drawing_landmarks if pose_detected else None)
    if ball_box:
        cv2.rectangle(
            annotated,
            (int(ball_box["x1"]), int(ball_box["y1"])),
            (int(ball_box["x2"]), int(ball_box["y2"])),
            (0, 165, 255),
            2,
        )
        cv2.putText(
            annotated,
            f"Basketball {ball_box['confidence']:.2f}",
            (int(ball_box["x1"]), max(12, int(ball_box["y1"]) - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 165, 255),
            2,
            cv2.LINE_AA,
        )

    response = FrameAnalysisResponse(
        session_id=session_id,
        mode=mode,
        timestamp=now_utc(),
        frame_index=frame_index,
        pose_detected=pose_detected,
        ball_detected=ball_detected,
        features=features,
        feedback=feedback,
        score=score,
        coaching_summary=summary,
        ball_box=ball_box,
        landmarks=landmarks,
        annotated_frame_base64=frame_to_base64(annotated) if include_base64 else None,
    )

    return {
        "response": response,
        "annotated_frame": annotated,
    }


def _pose_detected_for_mode(pose_result: dict[str, Any], *, mode: str) -> bool:
    if not bool(pose_result.get("pose_detected", False)):
        return False
    if mode not in POSE_CONFIDENCE_GATED_MODES:
        return True
    return len(_landmarks_for_mode(pose_result, mode=mode)) >= MIN_CONFIDENT_POSE_LANDMARKS


def _landmarks_for_mode(pose_result: dict[str, Any], *, mode: str) -> dict[str, Any]:
    landmarks = pose_result.get("landmarks") or {}
    if mode not in POSE_CONFIDENCE_GATED_MODES:
        return landmarks
    return {
        name: point
        for name, point in landmarks.items()
        if _landmark_visibility(point) >= POSE_CONFIDENCE_THRESHOLD
    }


def _landmark_visibility(point: Any) -> float:
    try:
        if isinstance(point, dict):
            return float(point.get("visibility", 0.0))
        return float(getattr(point, "visibility", 0.0))
    except (TypeError, ValueError):
        return 0.0


def _cap_invalid_frame_score(
    score: ScoreResult,
    *,
    mode: str,
    pose_detected: bool,
    ball_detected: bool,
    features: Any = None,
) -> ScoreResult:
    cap = None
    if not pose_detected and not ball_detected:
        cap = 12
    elif not pose_detected:
        cap = 25
    elif mode == "shooting_form" and not ball_detected:
        cap = 82
    elif mode == "shooting_form" and ball_detected and not _is_shooting_release_frame(features):
        cap = 72
    elif not ball_detected and mode != "shooting_form":
        cap = 55

    if cap is None or score.score <= cap:
        return score

    capped_score = max(0, cap)
    return ScoreResult(
        score=capped_score,
        deductions=max(score.deductions, 100 - capped_score),
        classification=classify_score(capped_score),
    )


def _is_shooting_release_frame(features: Any) -> bool:
    release_position = getattr(features, "ball_release_position", None)
    try:
        if release_position is not None:
            return float(release_position) >= 0
    except (TypeError, ValueError):
        return False
    return getattr(features, "ball_vertical_zone", None) == "high"
