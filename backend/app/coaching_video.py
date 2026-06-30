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
from .phase_scoring import PhaseScoreAggregator
from .pose_comparison import PoseComparisonAggregator
from .shot_training import (
    ANNOTATED_VIDEO_CRF,
    ANNOTATED_VIDEO_PRESET,
    AnnotatedVideoWriter,
    SHOT_TRAINING_COLORS,
    SHOT_TRAINING_CONFIDENCE_OVERRIDES,
    ShotTrainingTracker,
    _apply_orientation_correction,
    _enable_capture_auto_orientation,
    _normalize_source_orientation,
    _orientation_label,
    _read_capture_orientation,
)
from .utils import DATA_DIR, append_session_history, now_utc


COACHING_VIDEO_UPLOADS_DIR = DATA_DIR / "coaching_video_uploads"
COACHING_VIDEO_OUTPUTS_DIR = DATA_DIR / "coaching_video_outputs"
COACHING_VIDEO_MAX_SECONDS = 180
COACHING_VIDEO_TEST_SECONDS = 15
SHOOTING_DETECTION_BOX_LABELS = {"player_shooting", "basket"}

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
        self.dribble_ready = True
        self.dribble_release_frames = 0
        self.min_dribble_release_frames = 1
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
        controlled_low_contact = ball_zone == "low"
        released_from_contact = ball_zone == "high"

        if controlled_low_contact and self.dribble_ready and not self.low_contact_active and self._can_count(frame_index):
            self.count += 1
            self.last_count_frame = frame_index
            self.dribble_ready = False
            self.dribble_release_frames = 0
        elif controlled_low_contact:
            self.dribble_release_frames = 0
        elif released_from_contact:
            self.dribble_release_frames += 1
            if self.dribble_release_frames >= self.min_dribble_release_frames:
                self.dribble_ready = True
        else:
            self.dribble_release_frames = 0

        self.low_contact_active = controlled_low_contact

    def _observe_passing(self, features: Any, frame_index: int) -> None:
        body_offset = _feature_float(features, "ball_body_offset")
        controlled = _is_at_or_below(body_offset, 0.85)
        released = _is_at_or_above(body_offset, 1.25)

        if controlled:
            self.pass_ready = True
            return

        if released and self.pass_ready and self._can_count(frame_index):
            self.count += 1
            self.last_count_frame = frame_index
            self.pass_ready = False

    def _can_count(self, frame_index: int) -> bool:
        return frame_index - self.last_count_frame >= self.min_gap_frames


def _overlay_policy(overlay_mode: str) -> dict[str, bool]:
    return {
        "use_annotated_frame": overlay_mode == "full_overlay",
        "show_detection_boxes": overlay_mode == "full_overlay",
        "show_cue_banner": overlay_mode in {"full_overlay", "focus_feedback"},
        "show_score_panel": True,
        "show_footer": overlay_mode != "score_only",
    }


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
        source_orientation: str = "auto",
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
        self.sample_stride = effective_coaching_sample_stride(mode, sample_stride)
        self.source_orientation = _normalize_source_orientation(source_orientation)

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
                source_orientation=self.source_orientation,
            )
            frame_height, frame_width = first_frame.shape[:2]
            output_orientation = _orientation_label(frame_width, frame_height)

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
                input_width=encoded_frame_width,
                input_height=encoded_frame_height,
                output_width=frame_width,
                output_height=frame_height,
                input_orientation=_orientation_label(encoded_frame_width, encoded_frame_height),
                output_orientation=output_orientation,
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
                shot_events=[],
                dominant_feedback=[],
                pose_comparison=[],
                phase_scores=[],
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
            pose_comparison = PoseComparisonAggregator(self.mode)
            phase_scoring = PhaseScoreAggregator(self.mode)
            latest_bundle: Optional[dict[str, Any]] = None
            landmark_smoother = LandmarkSmoother(min_cutoff=1.2, beta=0.03, derivative_cutoff=1.0)
            action_counter = CoachingActionCounter(self.mode, fps=fps)
            shot_tracker = ShotTrainingTracker(fps) if self.mode == "shooting_form" else None
            overlay_policy = _overlay_policy(self.overlay_mode)
            frame = first_frame

            while frame_index < max_frames:
                _raise_if_cancelled(self.file_id)
                shot_detections: list[Dict[str, float | str]] = []
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
                        pose_comparison.observe(response.features)
                    if response.ball_detected:
                        ball_frames += 1
                    if self.mode == "shooting_form" and _has_shooting_evidence(response):
                        shooting_evidence_frames += 1
                    score_value = response.score.score
                    score_total += score_value
                    phase_scoring.observe(response)
                    best_score = max(best_score, score_value)
                    worst_score = min(worst_score, score_value)
                    for cue in response.feedback:
                        if cue.code == "solid_form":
                            continue
                        feedback_counts[cue.message] = feedback_counts.get(cue.message, 0) + 1

                if latest_bundle is None:
                    raise RuntimeError("Coaching analysis did not produce any frame results.")

                response = latest_bundle["response"]
                if should_analyze and overlay_policy["use_annotated_frame"]:
                    annotated = latest_bundle["annotated_frame"].copy()
                else:
                    annotated = frame.copy()

                self._draw_status_overlay(
                    annotated,
                    response=response,
                    action_counter=action_counter,
                    shot_tracker=shot_tracker,
                    shot_detections=shot_detections,
                    overlay_policy=overlay_policy,
                )
                writer.write(annotated)

                frame_index += 1

                if frame_index % 10 == 0 or frame_index == max_frames:
                    raw_average_score = round(score_total / max(analyzed_frames, 1), 2)
                    phase_scores = phase_scoring.build()
                    pose_comparison_results = pose_comparison.build()
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
                    progress_validity = apply_coaching_clip_validity(
                        mode=self.mode,
                        average_score=raw_average_score,
                        best_score=best_score,
                        worst_score=0 if worst_score == 100 and analyzed_frames == 0 else worst_score,
                        analyzed_frames=analyzed_frames,
                        pose_frames=pose_frames,
                        ball_frames=ball_frames,
                        action_label=action_counter.action_label,
                        action_count=_display_action_count(action_counter, shot_tracker),
                        shooting_evidence_frames=shooting_evidence_frames,
                        shooting_setup_frames=_phase_frame_count(phase_scores, "set_position"),
                        shooting_release_frames=_phase_frame_count(phase_scores, "release"),
                        shooting_follow_through_frames=_phase_frame_count(phase_scores, "follow_through"),
                        shooting_setup_score=_phase_average_score(phase_scores, "set_position"),
                        shooting_follow_through_score=_phase_average_score(phase_scores, "follow_through"),
                        pose_comparison=pose_comparison_results,
                    )
                    display_feedback = merge_validity_warnings(progress_validity.warnings, dominant_feedback)
                    _update_job(
                        self.file_id,
                        status="processing",
                        processed_frames=frame_index,
                        total_frames=max_frames,
                        progress_percentage=int((frame_index / max(max_frames, 1)) * 100),
                        output_width=frame_width,
                        output_height=frame_height,
                        output_orientation=output_orientation,
                        analyzed_frames=analyzed_frames,
                        pose_frames=pose_frames,
                        ball_frames=ball_frames,
                        pose_detection_rate=_percent(pose_frames, analyzed_frames),
                        ball_detection_rate=_percent(ball_frames, analyzed_frames),
                        average_score=progress_validity.average_score,
                        best_score=progress_validity.best_score,
                        worst_score=progress_validity.worst_score,
                        action_count=_display_action_count(action_counter, shot_tracker),
                        action_label=_display_action_label(action_counter, shot_tracker),
                        shooting_stats=_shooting_stats(shot_tracker),
                        shot_events=_shot_events(shot_tracker),
                        dominant_feedback=display_feedback,
                        pose_comparison=pose_comparison_results,
                        phase_scores=phase_scores,
                        classification=progress_validity.classification,
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
                    source_orientation=self.source_orientation,
                )

            writer.close()
            writer = None
            if shot_tracker is not None:
                shot_tracker.finalize_pending_attempt(frame_index)

            raw_average_score = round(score_total / max(analyzed_frames, 1), 2)
            phase_scores = phase_scoring.build()
            pose_comparison_results = pose_comparison.build()
            average_score = raw_average_score
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
                shooting_setup_frames=_phase_frame_count(phase_scores, "set_position"),
                shooting_release_frames=_phase_frame_count(phase_scores, "release"),
                shooting_follow_through_frames=_phase_frame_count(phase_scores, "follow_through"),
                shooting_setup_score=_phase_average_score(phase_scores, "set_position"),
                shooting_follow_through_score=_phase_average_score(phase_scores, "follow_through"),
                pose_comparison=pose_comparison_results,
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
                f"{self.mode.replace('_', ' ').title()} video analysis finished with an overall technique score of "
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
                    "shot_events": _shot_events(shot_tracker),
                    "phase_scores": phase_scores,
                    "pose_comparison": pose_comparison_results,
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
                output_width=frame_width,
                output_height=frame_height,
                output_orientation=output_orientation,
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
                shot_events=_shot_events(shot_tracker),
                dominant_feedback=dominant_feedback,
                pose_comparison=pose_comparison_results,
                phase_scores=phase_scores,
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
        shot_detections: Optional[list[Dict[str, float | str]]] = None,
        overlay_policy: Optional[dict[str, bool]] = None,
    ) -> None:
        policy = overlay_policy or _overlay_policy(self.overlay_mode)
        if policy["show_detection_boxes"] and shot_tracker is not None and shot_detections:
            _draw_shooting_detection_boxes(frame, shot_detections)

        if policy["show_cue_banner"]:
            primary_label = _simple_feedback_label(self.mode, response)
            secondary_label = _simple_summary_label(self.mode, response, action_counter, shot_tracker)
            overlay = frame.copy()
            height, width = frame.shape[:2]
            banner_height = 64 if width > height else 74
            cv2.rectangle(overlay, (18, 18), (width - 18, 18 + banner_height), (10, 16, 28), -1)
            cv2.addWeighted(overlay, 0.58, frame, 0.42, 0, frame)
            cv2.putText(
                frame,
                primary_label,
                (34, 56),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.66 if width > height else 0.75,
                (255, 225, 120),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                frame,
                secondary_label,
                (34, 78),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                (235, 240, 250),
                1,
                cv2.LINE_AA,
            )

        if policy["show_score_panel"]:
            self._draw_score_panel(
                frame,
                response=response,
                action_counter=action_counter,
                result_only=self.overlay_mode == "score_only",
            )
        if shot_tracker is not None:
            _draw_shooting_count_panel(frame, shot_tracker)
        if policy["show_footer"]:
            self._draw_footer(frame)

    def _draw_score_panel(
        self,
        frame: np.ndarray,
        *,
        response: Any,
        action_counter: CoachingActionCounter,
        result_only: bool = False,
    ) -> None:
        height, width = frame.shape[:2]
        landscape = width > height
        panel_width = min(width - 32, 560 if landscape else 390)
        panel_height = 82 if landscape else 118
        x = 16
        y = max(16, height - panel_height - 16)

        overlay = frame.copy()
        cv2.rectangle(overlay, (x, y), (x + panel_width, y + panel_height), (18, 22, 34), -1)
        cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
        cv2.rectangle(frame, (x, y), (x + panel_width, y + panel_height), (20, 105, 255), 2)

        landmarks_count = len(response.landmarks or {})
        detail_label = "LANDMARKS"
        detail_value = str(landmarks_count)
        if action_counter.action_label:
            detail_label = action_counter.action_label.upper()
            detail_value = str(action_counter.count)

        if result_only:
            if landscape:
                _draw_metric(frame, "SCORE", str(response.score.score), x + 18, y + 24, (255, 255, 255), value_scale=0.68)
                _draw_metric(frame, "CLASS", response.score.classification, x + 132, y + 24, (60, 220, 100), value_scale=0.62)
                cv2.putText(
                    frame,
                    f"{detail_label} {detail_value}",
                    (x + min(336, max(196, panel_width - 170)), y + 58),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (235, 240, 250),
                    2,
                    cv2.LINE_AA,
                )
                return

            _draw_metric(frame, "SCORE", str(response.score.score), x + 18, y + 28, (255, 255, 255))
            _draw_metric(frame, "CLASS", response.score.classification, x + 140, y + 28, (60, 220, 100))
            cv2.putText(
                frame,
                f"{detail_label} {detail_value}",
                (x + 18, y + 92),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.68,
                (235, 240, 250),
                2,
                cv2.LINE_AA,
            )
            return

        if landscape:
            detail_x = min(x + 470, max(x + 18, x + panel_width - 112))
            _draw_metric(frame, "SCORE", str(response.score.score), x + 18, y + 24, (255, 255, 255), value_scale=0.64)
            _draw_metric(frame, "CLASS", response.score.classification, x + 116, y + 24, (60, 220, 100), value_scale=0.58)
            _draw_metric(frame, "POSE", "Locked" if response.pose_detected else "Search", x + 266, y + 24, (0, 255, 255), value_scale=0.58)
            _draw_metric(frame, "BALL", "Locked" if response.ball_detected else "Search", x + 374, y + 24, (255, 180, 80), value_scale=0.58)
            cv2.putText(
                frame,
                f"{detail_label} {detail_value}",
                (detail_x, y + 58),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.52,
                (235, 240, 250),
                2,
                cv2.LINE_AA,
            )
            return

        _draw_metric(frame, "SCORE", str(response.score.score), x + 18, y + 28, (255, 255, 255))
        _draw_metric(frame, "CLASS", response.score.classification, x + 130, y + 28, (60, 220, 100))
        _draw_metric(frame, "POSE", "Locked" if response.pose_detected else "Search", x + 264, y + 28, (0, 255, 255))
        _draw_metric(frame, "BALL", "Locked" if response.ball_detected else "Search", x + 18, y + 78, (255, 180, 80))
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
    source_orientation: str = "auto",
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
            "source_orientation": _normalize_source_orientation(source_orientation),
            "processed_frames": 0,
            "total_frames": 0,
            "progress_percentage": 0,
            "input_width": 0,
            "input_height": 0,
            "output_width": 0,
            "output_height": 0,
            "input_orientation": "unknown",
            "output_orientation": "unknown",
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
            "shot_events": [],
            "dominant_feedback": [],
            "pose_comparison": [],
            "phase_scores": [],
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
        source_orientation=source_orientation,
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
                "source_orientation": None,
                "processed_frames": 0,
                "total_frames": 0,
                "progress_percentage": 0,
                "input_width": 0,
                "input_height": 0,
                "output_width": 0,
                "output_height": 0,
                "input_orientation": "unknown",
                "output_orientation": "unknown",
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
                "shot_events": [],
                "dominant_feedback": [],
                "pose_comparison": [],
                "phase_scores": [],
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


def effective_coaching_sample_stride(mode: str, sample_stride: int) -> int:
    normalized_stride = max(1, sample_stride)
    if mode == "dribbling":
        return min(normalized_stride, 2)
    return normalized_stride


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


def _shot_events(shot_tracker: Optional[ShotTrainingTracker]) -> list[dict[str, object]]:
    if shot_tracker is None:
        return []
    return shot_tracker.to_shot_events()


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


def _simple_feedback_label(mode: str, response: Any) -> str:
    if not bool(getattr(response, "pose_detected", False)):
        return "Step fully into frame"
    if not bool(getattr(response, "ball_detected", False)):
        return "Keep the ball visible"

    feedback_text = _first_feedback_text(response)
    normalized = feedback_text.lower()
    score = _response_score_value(response)
    features = getattr(response, "features", None)

    if mode == "dribbling":
        ball_zone = _feature_value(features, "ball_vertical_zone")
        if ball_zone == "high" or "high" in normalized:
            return "Keep dribble below hip"
        if "balance" in normalized:
            return "Stay low and balanced"
        return "Good low control" if score >= 75 else "Control each bounce"

    if mode == "passing":
        if "balance" in normalized:
            return "Hold balance after pass"
        if "release" in normalized or "target" in normalized:
            return "Aim release at target"
        return "Clean pass release" if score >= 75 else "Finish hands to target"

    if "setup" in normalized:
        return "Show clear shot setup"
    if "elbow" in normalized:
        return "Align elbow under ball"
    if "balance" in normalized or "landing" in normalized:
        return "Land balanced"
    if "follow" in normalized:
        return "Hold follow-through"
    return "Good shooting rhythm" if score >= 75 else "Track setup and release"


def _simple_summary_label(
    mode: str,
    response: Any,
    action_counter: CoachingActionCounter,
    shot_tracker: Optional[ShotTrainingTracker],
) -> str:
    if shot_tracker is not None:
        return _short_overlay_text(
            f"Shots {shot_tracker.attempts} | Makes {shot_tracker.makes} | Misses {shot_tracker.misses}"
        )

    action_label = action_counter.action_label
    if action_label:
        return _short_overlay_text(f"{action_label}: {action_counter.count} | Replay the best reps")

    summary = str(getattr(response, "coaching_summary", "") or "")
    if summary:
        return _short_overlay_text(summary)

    if mode == "dribbling":
        return "Watch hand, bounce, and stance"
    if mode == "passing":
        return "Watch release, target, and balance"
    return "Watch setup, release, and follow-through"


def _first_feedback_text(response: Any) -> str:
    feedback = getattr(response, "feedback", None) or []
    if not feedback:
        return ""
    cue = feedback[0]
    parts = [str(getattr(cue, "code", "") or ""), str(getattr(cue, "message", "") or "")]
    return " ".join(part for part in parts if part)


def _response_score_value(response: Any) -> float:
    score = getattr(response, "score", None)
    value = getattr(score, "score", 0)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _short_overlay_text(text: str, max_length: int = 76) -> str:
    normalized = " ".join(str(text or "").split())
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 3].rstrip() + "..."


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


def _draw_shooting_detection_boxes(frame: np.ndarray, detections: list[Dict[str, float | str]]) -> None:
    for detection in detections:
        label = str(detection.get("label") or "")
        if label not in SHOOTING_DETECTION_BOX_LABELS:
            continue

        display_label = str(detection.get("display_label") or label.replace("_", " ").title())
        confidence = float(detection.get("confidence", 0.0))
        x1 = int(float(detection["x1"]))
        y1 = int(float(detection["y1"]))
        x2 = int(float(detection["x2"]))
        y2 = int(float(detection["y2"]))
        color = SHOT_TRAINING_COLORS.get(label, (255, 255, 255))
        text = f"{display_label} {confidence:.2f}"

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        text_origin = (x1, max(18, y1 - 8))
        cv2.putText(
            frame,
            text,
            text_origin,
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )


def _has_shooting_evidence(response: Any) -> bool:
    if not bool(getattr(response, "pose_detected", False)) or not bool(getattr(response, "ball_detected", False)):
        return False
    features = getattr(response, "features", None)
    ball_zone = _feature_value(features, "ball_vertical_zone")
    release_position = _feature_float(features, "ball_release_position")
    if release_position is not None:
        return release_position >= 0
    return ball_zone == "high"


def _phase_frame_count(phase_scores: list[dict[str, object]], key: str) -> int:
    for phase in phase_scores:
        if str(phase.get("key") or "") != key:
            continue
        try:
            return int(phase.get("frame_count") or 0)
        except (TypeError, ValueError):
            return 0
    return 0


def _phase_average_score(phase_scores: list[dict[str, object]], key: str) -> Optional[float]:
    for phase in phase_scores:
        if str(phase.get("key") or "") != key:
            continue
        try:
            return float(phase.get("average_score") or 0.0)
        except (TypeError, ValueError):
            return None
    return None


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
    value_scale: float = 0.78,
) -> None:
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (165, 175, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, value, (x, y + 28), cv2.FONT_HERSHEY_SIMPLEX, value_scale, color, 2, cv2.LINE_AA)
