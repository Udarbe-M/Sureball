from __future__ import annotations

from typing import Any
from typing import Optional

import cv2
import numpy as np

from .feedback_engine import extract_features, generate_feedback
from .scoring import calculate_score
from .schemas import FeedbackCue, FrameAnalysisResponse
from .utils import draw_text_block, frame_to_base64, now_utc


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
    ball_box = ball_detector.detect(frame)
    features = extract_features(mode=mode, landmarks=pose_result["landmarks"], ball_box=ball_box)
    feedback, summary = generate_feedback(mode=mode, features=features, ball_detected=ball_box is not None)
    if not pose_result["pose_detected"]:
        feedback.insert(
            0,
            FeedbackCue(
                code="pose_not_detected",
                message="Step fully into frame so your body landmarks can be tracked.",
                severity="high",
                deduction=18,
            ),
        )
    score = calculate_score(feedback)

    annotated = pose_estimator.draw(frame, pose_result.get("drawing_landmarks") or pose_result["raw_landmarks"])
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

    text_lines = [
        f"Mode: {mode.replace('_', ' ').title()}",
        f"Score: {score.score} ({score.classification})",
        f"Cue: {feedback[0].message}",
    ]
    annotated = draw_text_block(annotated, text_lines)

    response = FrameAnalysisResponse(
        session_id=session_id,
        mode=mode,
        timestamp=now_utc(),
        frame_index=frame_index,
        pose_detected=bool(pose_result["pose_detected"]),
        ball_detected=ball_box is not None,
        features=features,
        feedback=feedback,
        score=score,
        coaching_summary=summary,
        ball_box=ball_box,
        landmarks=pose_result["landmarks"],
        annotated_frame_base64=frame_to_base64(annotated) if include_base64 else None,
    )

    return {
        "response": response,
        "annotated_frame": annotated,
    }
