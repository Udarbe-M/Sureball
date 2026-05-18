from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import cv2
import numpy as np
from fastapi import UploadFile

from .coaching_analysis import run_coaching_analysis
from .one_euro import LandmarkSmoother
from .scoring import classify_score
from .shot_training import (
    ANNOTATED_VIDEO_CRF,
    ANNOTATED_VIDEO_PRESET,
    AnnotatedVideoWriter,
    _apply_orientation_correction,
    _enable_capture_auto_orientation,
    _read_capture_orientation,
)
from .utils import DATA_DIR, append_session_history, now_utc


COACHING_VIDEO_UPLOADS_DIR = DATA_DIR / "coaching_video_uploads"
COACHING_VIDEO_OUTPUTS_DIR = DATA_DIR / "coaching_video_outputs"
COACHING_VIDEO_MAX_SECONDS = 180
COACHING_VIDEO_TEST_SECONDS = 15

coaching_video_jobs: Dict[str, Dict[str, object]] = {}
coaching_video_lock = threading.Lock()


def ensure_coaching_video_dirs() -> None:
    COACHING_VIDEO_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    COACHING_VIDEO_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


class CoachingVideoJob:
    def __init__(
        self,
        *,
        file_id: str,
        mode: str,
        pose_estimator: Any,
        ball_detector: Any,
        input_path: Path,
        output_path: Path,
        overlay_mode: str,
        test_mode: bool,
        user_key: str,
        sample_stride: int,
    ) -> None:
        self.file_id = file_id
        self.mode = mode
        self.pose_estimator = pose_estimator
        self.ball_detector = ball_detector
        self.input_path = input_path
        self.output_path = output_path
        self.overlay_mode = overlay_mode
        self.test_mode = test_mode
        self.user_key = user_key
        self.sample_stride = max(1, sample_stride)

    def run(self) -> None:
        capture = cv2.VideoCapture(str(self.input_path))
        writer: Optional[AnnotatedVideoWriter] = None
        try:
            if not capture.isOpened():
                raise RuntimeError("Unable to open the selected coaching video.")

            fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
            encoded_frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            encoded_frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            max_frames = total_frames
            if max_frames <= 0:
                max_frames = int(fps * (COACHING_VIDEO_TEST_SECONDS if self.test_mode else COACHING_VIDEO_MAX_SECONDS))
            else:
                duration_limit = COACHING_VIDEO_TEST_SECONDS if self.test_mode else COACHING_VIDEO_MAX_SECONDS
                max_frames = min(max_frames, int(fps * duration_limit))

            if encoded_frame_width <= 0 or encoded_frame_height <= 0:
                raise RuntimeError("Unable to read the selected coaching video's frame size.")

            auto_orientation_enabled = _enable_capture_auto_orientation(capture)
            orientation_degrees = _read_capture_orientation(capture)

            success, first_frame = capture.read()
            if not success or first_frame is None:
                raise RuntimeError("Unable to read frames from the selected coaching video.")

            first_frame = _apply_orientation_correction(
                first_frame,
                orientation_degrees,
                auto_orientation_enabled=auto_orientation_enabled,
                encoded_frame_size=(encoded_frame_width, encoded_frame_height),
            )
            frame_height, frame_width = first_frame.shape[:2]

            writer = AnnotatedVideoWriter(
                output_path=self.output_path,
                fps=fps,
                frame_size=(frame_width, frame_height),
            )

            _update_job(
                self.file_id,
                status="processing",
                processed_frames=0,
                total_frames=max_frames,
                progress_percentage=0,
                analyzed_frames=0,
                average_score=0.0,
                best_score=0,
                worst_score=0,
                dominant_feedback=[],
                classification=None,
                summary=None,
            )

            frame_index = 0
            analyzed_frames = 0
            score_total = 0.0
            best_score = 0
            worst_score = 100
            feedback_counts: dict[str, int] = {}
            latest_bundle: Optional[dict[str, Any]] = None
            landmark_smoother = LandmarkSmoother(min_cutoff=1.2, beta=0.03, derivative_cutoff=1.0)
            frame = first_frame

            while frame_index < max_frames:
                should_analyze = latest_bundle is None or frame_index % self.sample_stride == 0
                if should_analyze:
                    latest_bundle = run_coaching_analysis(
                        frame,
                        mode=self.mode,
                        session_id=self.file_id,
                        frame_index=frame_index,
                        pose_estimator=self.pose_estimator,
                        ball_detector=self.ball_detector,
                        landmark_smoother=landmark_smoother,
                        timestamp_seconds=frame_index / max(fps, 1.0),
                        include_base64=False,
                    )
                    response = latest_bundle["response"]
                    analyzed_frames += 1
                    score_value = response.score.score
                    score_total += score_value
                    best_score = max(best_score, score_value)
                    worst_score = min(worst_score, score_value)
                    for cue in response.feedback:
                        if cue.code == "solid_form":
                            continue
                        feedback_counts[cue.message] = feedback_counts.get(cue.message, 0) + 1

                if latest_bundle is None:
                    raise RuntimeError("Coaching analysis did not produce any frame results.")

                response = latest_bundle["response"]
                if should_analyze and self.overlay_mode == "full_overlay":
                    annotated = latest_bundle["annotated_frame"].copy()
                else:
                    annotated = frame.copy()

                self._draw_status_overlay(annotated, response=response)
                writer.write(annotated)

                frame_index += 1

                if frame_index % 10 == 0 or frame_index == max_frames:
                    average_score = round(score_total / max(analyzed_frames, 1), 2)
                    dominant_feedback = [
                        message
                        for message, _count in sorted(
                            feedback_counts.items(),
                            key=lambda entry: entry[1],
                            reverse=True,
                        )[:3]
                    ]
                    _update_job(
                        self.file_id,
                        status="processing",
                        processed_frames=frame_index,
                        total_frames=max_frames,
                        progress_percentage=int((frame_index / max(max_frames, 1)) * 100),
                        analyzed_frames=analyzed_frames,
                        average_score=average_score,
                        best_score=best_score,
                        worst_score=0 if worst_score == 100 and analyzed_frames == 0 else worst_score,
                        dominant_feedback=dominant_feedback,
                    )

                if frame_index >= max_frames:
                    break

                success, next_frame = capture.read()
                if not success or next_frame is None:
                    break
                frame = _apply_orientation_correction(
                    next_frame,
                    orientation_degrees,
                    auto_orientation_enabled=auto_orientation_enabled,
                    encoded_frame_size=(encoded_frame_width, encoded_frame_height),
                )

            writer.close()
            writer = None

            average_score = round(score_total / max(analyzed_frames, 1), 2)
            dominant_feedback = [
                message
                for message, _count in sorted(
                    feedback_counts.items(),
                    key=lambda entry: entry[1],
                    reverse=True,
                )[:3]
            ]
            if not dominant_feedback:
                dominant_feedback = ["Strong overall movement quality detected."]

            classification = classify_score(average_score)
            summary = (
                f"{self.mode.replace('_', ' ').title()} video analysis finished with an average score of "
                f"{average_score:.1f}. Focus areas: {', '.join(dominant_feedback)}"
            )

            append_session_history(
                {
                    "session_id": self.file_id,
                    "mode": self.mode,
                    "timestamp": now_utc().isoformat(),
                    "score": average_score,
                    "classification": classification,
                    "summary": summary,
                    "source_type": "video",
                    "user_key": self.user_key,
                }
            )

            _update_job(
                self.file_id,
                status="completed",
                processed_frames=frame_index,
                total_frames=max(frame_index, max_frames),
                progress_percentage=100,
                analyzed_frames=analyzed_frames,
                average_score=average_score,
                best_score=best_score,
                worst_score=0 if worst_score == 100 and analyzed_frames == 0 else worst_score,
                dominant_feedback=dominant_feedback,
                classification=classification,
                summary=summary,
            )
        except Exception as exc:
            _update_job(
                self.file_id,
                status="error",
                error_message=str(exc),
            )
        finally:
            capture.release()
            if writer is not None:
                writer.abort()

    def _draw_status_overlay(self, frame: np.ndarray, *, response: Any) -> None:
        if self.overlay_mode in {"full_overlay", "focus_feedback"}:
            overlay = frame.copy()
            cv2.rectangle(overlay, (18, 18), (frame.shape[1] - 18, 92), (10, 16, 28), -1)
            cv2.addWeighted(overlay, 0.58, frame, 0.42, 0, frame)
            cv2.putText(
                frame,
                response.feedback[0].message,
                (34, 58),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 225, 120),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                frame,
                response.coaching_summary,
                (34, 82),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                (235, 240, 250),
                1,
                cv2.LINE_AA,
            )

        self._draw_score_panel(frame, response=response)
        self._draw_footer(frame)

    def _draw_score_panel(self, frame: np.ndarray, *, response: Any) -> None:
        height, width = frame.shape[:2]
        panel_width = min(width - 32, 390)
        panel_height = 118
        x = 16
        y = max(16, height - panel_height - 16)

        overlay = frame.copy()
        cv2.rectangle(overlay, (x, y), (x + panel_width, y + panel_height), (18, 22, 34), -1)
        cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
        cv2.rectangle(frame, (x, y), (x + panel_width, y + panel_height), (20, 105, 255), 2)

        _draw_metric(frame, "SCORE", str(response.score.score), x + 18, y + 28, (255, 255, 255))
        _draw_metric(frame, "CLASS", response.score.classification, x + 130, y + 28, (60, 220, 100))
        _draw_metric(frame, "POSE", "Locked" if response.pose_detected else "Search", x + 264, y + 28, (0, 255, 255))
        _draw_metric(frame, "BALL", "Locked" if response.ball_detected else "Search", x + 18, y + 78, (255, 180, 80))

        landmarks_count = len(response.landmarks or {})
        cv2.putText(
            frame,
            f"LANDMARKS {landmarks_count}",
            (x + 130, y + 92),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.68,
            (235, 240, 250),
            2,
            cv2.LINE_AA,
        )

    def _draw_footer(self, frame: np.ndarray) -> None:
        footer = f"{self.mode.replace('_', ' ').title()} | {self.overlay_mode.replace('_', ' ').title()}"
        if self.test_mode:
            footer = f"{footer} | Test clip"
        cv2.putText(
            frame,
            footer,
            (18, frame.shape[0] - 18),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (230, 230, 230),
            1,
            cv2.LINE_AA,
        )


def start_coaching_video_job(
    *,
    mode: str,
    pose_estimator: Any,
    ball_detector: Any,
    video: UploadFile,
    overlay_mode: str,
    test_mode: bool,
    user_key: str,
    sample_stride: int = 5,
) -> dict[str, object]:
    ensure_coaching_video_dirs()

    file_id = uuid.uuid4().hex
    suffix = Path(video.filename or "coaching-video.mp4").suffix or ".mp4"
    input_path = COACHING_VIDEO_UPLOADS_DIR / f"{file_id}{suffix}"
    output_path = COACHING_VIDEO_OUTPUTS_DIR / f"{file_id}_annotated.mp4"

    with input_path.open("wb") as output_file:
        output_file.write(video.file.read())

    with coaching_video_lock:
        coaching_video_jobs[file_id] = {
            "file_id": file_id,
            "mode": mode,
            "status": "queued",
            "overlay_mode": overlay_mode,
            "test_mode": test_mode,
            "processed_frames": 0,
            "total_frames": 0,
            "progress_percentage": 0,
            "analyzed_frames": 0,
            "average_score": 0.0,
            "best_score": 0,
            "worst_score": 0,
            "dominant_feedback": [],
            "classification": None,
            "summary": None,
            "error_message": None,
            "user_key": user_key,
        }

    worker = CoachingVideoJob(
        file_id=file_id,
        mode=mode,
        pose_estimator=pose_estimator,
        ball_detector=ball_detector,
        input_path=input_path,
        output_path=output_path,
        overlay_mode=overlay_mode,
        test_mode=test_mode,
        user_key=user_key,
        sample_stride=sample_stride,
    )
    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()
    return coaching_video_jobs[file_id].copy()


def get_coaching_video_status(file_id: str) -> dict[str, object]:
    with coaching_video_lock:
        job = coaching_video_jobs.get(file_id)
        if not job:
            return {
                "file_id": file_id,
                "mode": None,
                "status": "not_found",
                "overlay_mode": None,
                "test_mode": False,
                "processed_frames": 0,
                "total_frames": 0,
                "progress_percentage": 0,
                "analyzed_frames": 0,
                "average_score": 0.0,
                "best_score": 0,
                "worst_score": 0,
                "dominant_feedback": [],
                "classification": None,
                "summary": None,
                "error_message": None,
            }
        return job.copy()


def get_coaching_video_output_path(file_id: str) -> Optional[Path]:
    output_path = COACHING_VIDEO_OUTPUTS_DIR / f"{file_id}_annotated.mp4"
    if output_path.exists():
        return output_path
    return None


def _update_job(file_id: str, **updates: object) -> None:
    with coaching_video_lock:
        current = coaching_video_jobs.get(file_id, {}).copy()
        current.update(updates)
        coaching_video_jobs[file_id] = current


def _draw_metric(
    frame: np.ndarray,
    label: str,
    value: str,
    x: int,
    y: int,
    color: tuple[int, int, int],
) -> None:
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (165, 175, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, value, (x, y + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.78, color, 2, cv2.LINE_AA)
