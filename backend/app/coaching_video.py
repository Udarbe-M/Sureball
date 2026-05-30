from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import cv2
import numpy as np
from fastapi import UploadFile

from .clip_validity import apply_coaching_clip_validity, merge_validity_warnings
from .coaching_analysis import run_coaching_analysis
from .one_euro import LandmarkSmoother
from .shot_training import (
    ANNOTATED_VIDEO_CRF,
    ANNOTATED_VIDEO_PRESET,
    AnnotatedVideoWriter,
    SHOT_TRAINING_CONFIDENCE_OVERRIDES,
    ShotTrainingTracker,
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


class CoachingVideoCancelled(RuntimeError):
    pass


def ensure_coaching_video_dirs() -> None:
    COACHING_VIDEO_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    COACHING_VIDEO_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


class CoachingActionCounter:
    def __init__(self, mode: str, *, fps: float) -> None:
        self.mode = mode
        self.count = 0
        self.action_label = _action_label_for_mode(mode)
        self.last_count_frame = -10_000
        self.min_gap_frames = max(5, int(fps * 0.25))
        self.low_contact_active = False
        self.pass_ready = False

    def observe(self, response: Any) -> None:
        if self.action_label is None or not bool(getattr(response, "ball_detected", False)):
            if self.mode == "dribbling":
                self.low_contact_active = False
            return

        features = getattr(response, "features", None)
        frame_index = int(getattr(response, "frame_index", 0) or 0)
        if self.mode == "dribbling":
            self._observe_dribbling(features, frame_index)
        elif self.mode == "passing":
            self._observe_passing(features, frame_index)

    def _observe_dribbling(self, features: Any, frame_index: int) -> None:
        ball_zone = _feature_value(features, "ball_vertical_zone")
        hand_distance = _feature_float(features, "ball_to_wrist_distance")
        controlled_low_contact = ball_zone == "low" and (hand_distance is None or hand_distance <= 1.1)

        if controlled_low_contact and not self.low_contact_active and self._can_count(frame_index):
            self.count += 1
            self.last_count_frame = frame_index

        self.low_contact_active = controlled_low_contact

    def _observe_passing(self, features: Any, frame_index: int) -> None:
        hand_distance = _feature_float(features, "ball_to_wrist_distance")
        body_offset = _feature_float(features, "ball_body_offset")
        controlled = _is_at_or_below(hand_distance, 0.55) or _is_at_or_below(body_offset, 0.85)
        released = _is_at_or_above(hand_distance, 0.85) or _is_at_or_above(body_offset, 1.25)

        if controlled:
            self.pass_ready = True
            return

        if released and self.pass_ready and self._can_count(frame_index):
            self.count += 1
            self.last_count_frame = frame_index
            self.pass_ready = False

    def _can_count(self, frame_index: int) -> bool:
        return frame_index - self.last_count_frame >= self.min_gap_frames


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
                pose_frames=0,
                ball_frames=0,
                pose_detection_rate=0.0,
                ball_detection_rate=0.0,
                average_score=0.0,
                best_score=0,
                worst_score=0,
                action_count=0,
                action_label=_action_label_for_mode(self.mode),
                shooting_stats={},
                dominant_feedback=[],
                classification=None,
                summary=None,
            )

            frame_index = 0
            analyzed_frames = 0
            score_total = 0.0
            best_score = 0
            worst_score = 100
            pose_frames = 0
            ball_frames = 0
            shooting_evidence_frames = 0
            feedback_counts: dict[str, int] = {}
            latest_bundle: Optional[dict[str, Any]] = None
            landmark_smoother = LandmarkSmoother(min_cutoff=1.2, beta=0.03, derivative_cutoff=1.0)
            action_counter = CoachingActionCounter(self.mode, fps=fps)
            shot_tracker = ShotTrainingTracker(fps) if self.mode == "shooting_form" else None
            frame = first_frame

            while frame_index < max_frames:
                _raise_if_cancelled(self.file_id)
                if shot_tracker is not None:
                    shot_detections = self.ball_detector.detect_training_objects(
                        frame,
                        confidence_overrides=SHOT_TRAINING_CONFIDENCE_OVERRIDES,
                    )
                    shot_tracker.observe(shot_detections, frame_index)

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
                    action_counter.observe(response)
                    analyzed_frames += 1
                    if response.pose_detected:
                        pose_frames += 1
                    if response.ball_detected:
                        ball_frames += 1
                    if self.mode == "shooting_form" and _has_shooting_evidence(response):
                        shooting_evidence_frames += 1
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

                self._draw_status_overlay(
                    annotated,
                    response=response,
                    action_counter=action_counter,
                    shot_tracker=shot_tracker,
                )
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
                        pose_frames=pose_frames,
                        ball_frames=ball_frames,
                        pose_detection_rate=_percent(pose_frames, analyzed_frames),
                        ball_detection_rate=_percent(ball_frames, analyzed_frames),
                        average_score=average_score,
                        best_score=best_score,
                        worst_score=0 if worst_score == 100 and analyzed_frames == 0 else worst_score,
                        action_count=_display_action_count(action_counter, shot_tracker),
                        action_label=_display_action_label(action_counter, shot_tracker),
                        shooting_stats=_shooting_stats(shot_tracker),
                        dominant_feedback=dominant_feedback,
                    )

                if frame_index >= max_frames:
                    break

                success, next_frame = capture.read()
                if not success or next_frame is None:
                    break
                _raise_if_cancelled(self.file_id)
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

            validity = apply_coaching_clip_validity(
                mode=self.mode,
                average_score=average_score,
                best_score=best_score,
                worst_score=0 if worst_score == 100 and analyzed_frames == 0 else worst_score,
                analyzed_frames=analyzed_frames,
                pose_frames=pose_frames,
                ball_frames=ball_frames,
                action_label=action_counter.action_label,
                action_count=_display_action_count(action_counter, shot_tracker),
                shooting_evidence_frames=shooting_evidence_frames,
            )
            average_score = validity.average_score
            best_score = validity.best_score
            worst_score = validity.worst_score
            dominant_feedback = merge_validity_warnings(validity.warnings, dominant_feedback)
            classification = validity.classification
            count_summary = _format_count_summary(
                _display_action_label(action_counter, shot_tracker),
                _display_action_count(action_counter, shot_tracker),
                shot_tracker=shot_tracker,
            )
            summary = (
                f"{self.mode.replace('_', ' ').title()} video analysis finished with an average score of "
                f"{average_score:.1f}.{count_summary} Focus areas: {', '.join(dominant_feedback)}"
            )

            append_session_history(
                {
                    "session_id": self.file_id,
                    "mode": self.mode,
                    "timestamp": now_utc().isoformat(),
                    "score": average_score,
                    "classification": classification,
                    "summary": summary,
                    "action_count": _display_action_count(action_counter, shot_tracker),
                    "action_label": _display_action_label(action_counter, shot_tracker),
                    "shooting_stats": _shooting_stats(shot_tracker),
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
                pose_frames=pose_frames,
                ball_frames=ball_frames,
                pose_detection_rate=_percent(pose_frames, analyzed_frames),
                ball_detection_rate=_percent(ball_frames, analyzed_frames),
                average_score=average_score,
                best_score=best_score,
                worst_score=0 if worst_score == 100 and analyzed_frames == 0 else worst_score,
                action_count=_display_action_count(action_counter, shot_tracker),
                action_label=_display_action_label(action_counter, shot_tracker),
                shooting_stats=_shooting_stats(shot_tracker),
                dominant_feedback=dominant_feedback,
                classification=classification,
                summary=summary,
            )
        except CoachingVideoCancelled:
            _update_job(
                self.file_id,
                status="cancelled",
                error_message=None,
                summary="Coaching video analysis was cancelled.",
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

    def _draw_status_overlay(
        self,
        frame: np.ndarray,
        *,
        response: Any,
        action_counter: CoachingActionCounter,
        shot_tracker: Optional[ShotTrainingTracker] = None,
    ) -> None:
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

        self._draw_score_panel(frame, response=response, action_counter=action_counter)
        if shot_tracker is not None:
            _draw_shooting_count_panel(frame, shot_tracker)
        self._draw_footer(frame)

    def _draw_score_panel(self, frame: np.ndarray, *, response: Any, action_counter: CoachingActionCounter) -> None:
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
        detail_label = "LANDMARKS"
        detail_value = str(landmarks_count)
        if action_counter.action_label:
            detail_label = action_counter.action_label.upper()
            detail_value = str(action_counter.count)
        cv2.putText(
            frame,
            f"{detail_label} {detail_value}",
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
            "pose_frames": 0,
            "ball_frames": 0,
            "pose_detection_rate": 0.0,
            "ball_detection_rate": 0.0,
            "average_score": 0.0,
            "best_score": 0,
            "worst_score": 0,
            "action_count": 0,
            "action_label": _action_label_for_mode(mode),
            "shooting_stats": {},
            "dominant_feedback": [],
            "classification": None,
            "summary": None,
            "error_message": None,
            "cancel_requested": False,
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
                "pose_frames": 0,
                "ball_frames": 0,
                "pose_detection_rate": 0.0,
                "ball_detection_rate": 0.0,
                "average_score": 0.0,
                "best_score": 0,
                "worst_score": 0,
                "action_count": 0,
                "action_label": None,
                "shooting_stats": {},
                "dominant_feedback": [],
                "classification": None,
                "summary": None,
                "error_message": None,
            }
        return job.copy()


def cancel_coaching_video_job(file_id: str) -> dict[str, object]:
    with coaching_video_lock:
        job = coaching_video_jobs.get(file_id)
        if not job:
            return {
                "file_id": file_id,
                "status": "not_found",
            }
        if job.get("status") in {"completed", "error", "cancelled"}:
            return job.copy()
        job["cancel_requested"] = True
        job["status"] = "cancelled"
        job["error_message"] = None
        job["summary"] = "Coaching video analysis was cancelled."
        coaching_video_jobs[file_id] = job
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


def _raise_if_cancelled(file_id: str) -> None:
    with coaching_video_lock:
        job = coaching_video_jobs.get(file_id, {})
        if job.get("cancel_requested") or job.get("status") == "cancelled":
            raise CoachingVideoCancelled()


def _action_label_for_mode(mode: str) -> Optional[str]:
    if mode == "dribbling":
        return "Dribbles"
    if mode == "passing":
        return "Passes"
    return None


def _display_action_count(action_counter: CoachingActionCounter, shot_tracker: Optional[ShotTrainingTracker]) -> int:
    if shot_tracker is not None:
        return shot_tracker.attempts
    return action_counter.count


def _display_action_label(action_counter: CoachingActionCounter, shot_tracker: Optional[ShotTrainingTracker]) -> Optional[str]:
    if shot_tracker is not None:
        return "Shots"
    return action_counter.action_label


def _shooting_stats(shot_tracker: Optional[ShotTrainingTracker]) -> dict[str, float | int]:
    if shot_tracker is None:
        return {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0}
    return shot_tracker.to_stats()


def _percent(part: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round((part / total) * 100.0, 1)


def _format_count_summary(action_label: Optional[str], count: int, *, shot_tracker: Optional[ShotTrainingTracker] = None) -> str:
    if shot_tracker is not None:
        return f" Shots: {shot_tracker.attempts}. Makes: {shot_tracker.makes}. Misses: {shot_tracker.misses}."
    if not action_label:
        return ""
    label = action_label.lower()
    return f" {count} {label} counted."


def _draw_shooting_count_panel(frame: np.ndarray, tracker: ShotTrainingTracker) -> None:
    height, width = frame.shape[:2]
    compact = width < 620 or height > width
    panel_width = min(210, max(156, int(width * (0.30 if compact else 0.22))))
    panel_height = 164 if compact else 182
    margin = 14
    x = max(margin, width - panel_width - margin)
    y_max = max(margin, height - panel_height - margin)
    y = y_max
    font_scale = 0.48 if compact else 0.52
    value_scale = 0.66 if compact else 0.72

    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + panel_width, y + panel_height), (10, 16, 28), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (x, y), (x + panel_width, y + panel_height), (20, 105, 255), 2)

    cv2.putText(frame, "SHOT COUNT", (x + 12, y + 26), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (165, 175, 200), 1, cv2.LINE_AA)
    value_x_offset = max(82, panel_width - 72)
    row_gap = 34 if compact else 38
    _draw_panel_stat(frame, "SHOTS", str(tracker.attempts), x + 12, y + 56, (255, 255, 255), value_x_offset, value_scale)
    _draw_panel_stat(frame, "MAKES", str(tracker.makes), x + 12, y + 56 + row_gap, (60, 220, 100), value_x_offset, value_scale)
    _draw_panel_stat(frame, "MISSES", str(tracker.misses), x + 12, y + 56 + row_gap * 2, (255, 180, 80), value_x_offset, value_scale)
    cv2.putText(
        frame,
        f"ACC {tracker.accuracy:.1f}%",
        (x + 12, y + panel_height - 16),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.54 if compact else 0.58,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )


def _draw_panel_stat(
    frame: np.ndarray,
    label: str,
    value: str,
    x: int,
    y: int,
    color: tuple[int, int, int],
    value_x_offset: int,
    value_scale: float,
) -> None:
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (165, 175, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, value, (x + value_x_offset, y + 1), cv2.FONT_HERSHEY_SIMPLEX, value_scale, color, 2, cv2.LINE_AA)


def _has_shooting_evidence(response: Any) -> bool:
    if not bool(getattr(response, "pose_detected", False)) or not bool(getattr(response, "ball_detected", False)):
        return False

    features = getattr(response, "features", None)
    hand_distance = _feature_float(features, "ball_to_wrist_distance")
    ball_zone = _feature_value(features, "ball_vertical_zone")
    release_position = _feature_float(features, "ball_release_position")

    near_hand = hand_distance is not None and hand_distance <= 0.8
    in_shooting_zone = ball_zone in {"torso", "high"}
    near_release_height = release_position is not None and release_position >= -0.05
    return near_hand and (in_shooting_zone or near_release_height)


def _feature_value(features: Any, key: str) -> Any:
    if features is None:
        return None
    if isinstance(features, dict):
        return features.get(key)
    return getattr(features, key, None)


def _feature_float(features: Any, key: str) -> Optional[float]:
    value = _feature_value(features, key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_at_or_below(value: Optional[float], threshold: float) -> bool:
    return value is not None and value <= threshold


def _is_at_or_above(value: Optional[float], threshold: float) -> bool:
    return value is not None and value >= threshold


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
