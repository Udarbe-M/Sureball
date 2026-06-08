from __future__ import annotations

import subprocess
import threading
import uuid
from collections import deque
from pathlib import Path
from typing import Dict, Optional

import cv2
import numpy as np
from fastapi import UploadFile

from .ball_detector import BallDetector
from .scoring import classify_score
from .utils import DATA_DIR, append_session_history, now_utc

try:
    from imageio_ffmpeg import get_ffmpeg_exe
except ImportError:
    get_ffmpeg_exe = None


SHOT_TRAINING_UPLOADS_DIR = DATA_DIR / "shot_training_uploads"
SHOT_TRAINING_OUTPUTS_DIR = DATA_DIR / "shot_training_outputs"
MAX_VIDEO_SECONDS = 180
TEST_MODE_SECONDS = 15
SHOT_COOLDOWN_SECONDS = 1.2
MAKE_COOLDOWN_SECONDS = 1.6
POST_MAKE_SHOT_SUPPRESSION_SECONDS = 0.45
HOOP_ONLY_MAKE_DUPLICATE_SECONDS = 2.4
MAKE_BANNER_SECONDS = 1.0
ATTEMPT_CONFIRMATION_FRAMES = 2
ATTEMPT_RESULT_WINDOW_SECONDS = 3.0
ACTIVE_ATTEMPT_ROLLOVER_SECONDS = 1.4
RECENT_SHOT_SIGNAL_SECONDS = 0.9
RECENT_BASKET_MEMORY_SECONDS = 0.6
RECENT_RIM_SEQUENCE_SECONDS = 0.75
DIRECT_MAKE_CONFIRMATION_FRAMES = 2
SINGLE_FRAME_HOOP_BALL_CONFIDENCE = 0.65
RECENT_DIRECT_MAKE_SECONDS = 0.35
RECENT_BASKET_PASS_SECONDS = 0.6
BASKET_OVERLAP_CONFIRMATION_FRAMES = 2
SUSTAINED_BASKET_OVERLAP_FRAMES = 4
RECENT_BASKET_OVERLAP_SECONDS = 0.35
RECENT_PRE_ATTEMPT_MAKE_SECONDS = 1.25
LATE_MAKE_RECOVERY_SECONDS = 2.0
POST_MISS_GHOST_ATTEMPT_SECONDS = 0.75
PENDING_ATTEMPT_FINALIZE_SECONDS = 0.75
SHOT_TRAINING_CONFIDENCE_OVERRIDES = {
    "player_shooting": 0.62,
    "ball_in_basket": 0.25,
}
ANNOTATED_VIDEO_CRF = 14
ANNOTATED_VIDEO_PRESET = "slow"

SHOT_TRAINING_COLORS = {
    "ball": (0, 165, 255),
    "ball_in_basket": (0, 255, 255),
    "player": (0, 200, 0),
    "basket": (40, 90, 255),
    "player_shooting": (255, 160, 0),
}

shot_training_jobs: Dict[str, Dict[str, object]] = {}
shot_training_lock = threading.Lock()


class ShotTrainingCancelled(RuntimeError):
    pass


def ensure_shot_training_dirs() -> None:
    SHOT_TRAINING_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_TRAINING_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


class AnnotatedVideoWriter:
    def __init__(self, output_path: Path, fps: float, frame_size: tuple[int, int]) -> None:
        self.output_path = output_path
        self.fps = max(fps, 1.0)
        self.frame_size = frame_size
        self.temp_output_path = output_path.with_name(f"{output_path.stem}_encoding{output_path.suffix}")
        self.backend_name = "opencv-mp4v"
        self._closed = False
        self._cv_writer: Optional[cv2.VideoWriter] = None
        self._ffmpeg_process: Optional[subprocess.Popen[bytes]] = None
        self._ffmpeg_stderr = b""
        self.temp_output_path.unlink(missing_ok=True)
        self.output_path.unlink(missing_ok=True)
        self._open_writer()

    def _open_writer(self) -> None:
        ffmpeg_exe = _resolve_ffmpeg_exe()
        if ffmpeg_exe is not None:
            command = [
                ffmpeg_exe,
                "-y",
                "-loglevel",
                "error",
                "-f",
                "rawvideo",
                "-vcodec",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{self.frame_size[0]}x{self.frame_size[1]}",
                "-r",
                _format_fps(self.fps),
                "-i",
                "-",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                ANNOTATED_VIDEO_PRESET,
                "-crf",
                str(ANNOTATED_VIDEO_CRF),
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(self.temp_output_path),
            ]
            self._ffmpeg_process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            self.backend_name = "ffmpeg-libx264"
            return

        self._cv_writer = cv2.VideoWriter(
            str(self.temp_output_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            self.fps,
            self.frame_size,
        )
        if not self._cv_writer.isOpened():
            raise RuntimeError("Unable to create the annotated result video.")

    def write(self, frame: np.ndarray) -> None:
        if frame.shape[1] != self.frame_size[0] or frame.shape[0] != self.frame_size[1]:
            raise RuntimeError("Annotated frame size changed during export.")
        frame = np.ascontiguousarray(frame)

        if self._ffmpeg_process is not None:
            stdin = self._ffmpeg_process.stdin
            if stdin is None:
                raise RuntimeError("Annotated result encoder is no longer available.")
            try:
                frame_bytes = frame.tobytes()
                bytes_written = stdin.write(frame_bytes)
                if bytes_written != len(frame_bytes):
                    raise RuntimeError("Annotated result encoder received an incomplete frame.")
            except BrokenPipeError as exc:
                raise RuntimeError(self._ffmpeg_failure_message()) from exc
            return

        if self._cv_writer is None:
            raise RuntimeError("Annotated result video writer is not initialized.")
        self._cv_writer.write(frame)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True

        if self._ffmpeg_process is not None:
            process = self._ffmpeg_process
            try:
                if process.stdin is not None:
                    process.stdin.close()
                if process.stderr is not None:
                    self._ffmpeg_stderr = process.stderr.read()
                return_code = process.wait(timeout=60)
                if return_code != 0:
                    raise RuntimeError(self._ffmpeg_failure_message())
            finally:
                self._ffmpeg_process = None

        if self._cv_writer is not None:
            self._cv_writer.release()
            self._cv_writer = None

        if not self.temp_output_path.exists() or self.temp_output_path.stat().st_size == 0:
            raise RuntimeError("Annotated result video export did not produce a playable file.")

        self.output_path.unlink(missing_ok=True)
        self.temp_output_path.replace(self.output_path)

    def abort(self) -> None:
        if self._ffmpeg_process is not None:
            process = self._ffmpeg_process
            self._ffmpeg_process = None
            try:
                if process.stdin is not None:
                    process.stdin.close()
            except OSError:
                pass
            process.kill()
            process.wait(timeout=10)

        if self._cv_writer is not None:
            self._cv_writer.release()
            self._cv_writer = None

        self.temp_output_path.unlink(missing_ok=True)

    def _ffmpeg_failure_message(self) -> str:
        details = self._ffmpeg_stderr.decode("utf-8", errors="replace").strip()
        if details:
            return f"Annotated result video export failed: {details}"
        return "Annotated result video export failed."


def _format_fps(fps: float) -> str:
    return f"{fps:.6f}".rstrip("0").rstrip(".")


def _resolve_ffmpeg_exe() -> Optional[str]:
    if get_ffmpeg_exe is None:
        return None
    try:
        return get_ffmpeg_exe()
    except Exception:
        return None


def _enable_capture_auto_orientation(capture: cv2.VideoCapture) -> bool:
    orientation_auto_prop = getattr(cv2, "CAP_PROP_ORIENTATION_AUTO", None)
    if orientation_auto_prop is None:
        return False
    try:
        return bool(capture.set(orientation_auto_prop, 1))
    except Exception:
        return False


def _read_capture_orientation(capture: cv2.VideoCapture) -> int:
    orientation_meta_prop = getattr(cv2, "CAP_PROP_ORIENTATION_META", None)
    if orientation_meta_prop is None:
        return 0
    try:
        return int(round(capture.get(orientation_meta_prop) or 0)) % 360
    except Exception:
        return 0


def _normalize_source_orientation(source_orientation: str) -> str:
    normalized = str(source_orientation or "auto").strip().lower()
    return normalized if normalized in {"auto", "portrait", "landscape"} else "auto"


def _orientation_label(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        return "unknown"
    if width > height:
        return "landscape"
    if height > width:
        return "portrait"
    return "square"


def _frame_matches_source_orientation(frame: np.ndarray, source_orientation: str) -> bool:
    frame_height, frame_width = frame.shape[:2]
    if source_orientation == "landscape":
        return frame_width >= frame_height
    if source_orientation == "portrait":
        return frame_height >= frame_width
    return True


def _rotate_for_orientation(frame: np.ndarray, orientation_degrees: int, *, inverse: bool = False) -> np.ndarray:
    normalized_orientation = orientation_degrees % 360
    if inverse:
        normalized_orientation = (-normalized_orientation) % 360
    rotation_map = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }
    rotate_code = rotation_map.get(normalized_orientation)
    if rotate_code is None:
        return frame
    return cv2.rotate(frame, rotate_code)


def _apply_orientation_correction(
    frame: np.ndarray,
    orientation_degrees: int,
    *,
    auto_orientation_enabled: bool,
    encoded_frame_size: tuple[int, int],
    source_orientation: str = "auto",
) -> np.ndarray:
    normalized_orientation = orientation_degrees % 360
    frame_height, frame_width = frame.shape[:2]
    encoded_width, encoded_height = encoded_frame_size

    source_orientation = _normalize_source_orientation(source_orientation)
    corrected = frame
    if normalized_orientation == 0:
        if source_orientation == "auto" or _frame_matches_source_orientation(corrected, source_orientation):
            return corrected
        return cv2.rotate(corrected, cv2.ROTATE_90_CLOCKWISE)

    # OpenCV may expose the raw encoded frame while mobile players rely on rotation metadata.
    # If auto-rotation was not applied, normalize frames ourselves before analysis/export.
    needs_manual_rotation = not auto_orientation_enabled
    if not needs_manual_rotation and normalized_orientation in {90, 270}:
        needs_manual_rotation = (
            frame_width == encoded_width
            and frame_height == encoded_height
            and encoded_width > 0
            and encoded_height > 0
        )

    if needs_manual_rotation:
        corrected = _rotate_for_orientation(frame, normalized_orientation)

    if source_orientation == "auto" or _frame_matches_source_orientation(corrected, source_orientation):
        return corrected

    if normalized_orientation in {90, 270}:
        candidate = _rotate_for_orientation(corrected, normalized_orientation, inverse=auto_orientation_enabled)
        if _frame_matches_source_orientation(candidate, source_orientation):
            return candidate

    return cv2.rotate(corrected, cv2.ROTATE_90_CLOCKWISE)


class ShotTrainingTracker:
    def __init__(self, fps: float) -> None:
        self.fps = max(fps, 1.0)
        self.attempts = 0
        self.makes = 0
        self._misses = 0
        self.last_attempt_frame = -10_000
        self.last_make_frame = -10_000
        self.last_shot_signal_frame = -10_000
        self.last_basket_center: Optional[tuple[int, int]] = None
        self.last_basket_radius = 0.0
        self.last_basket_detection: Optional[Dict[str, float | str]] = None
        self.last_basket_frame = -10_000
        self.banner_text = "Ready to analyze."
        self.banner_until_frame = -1
        self.pending_shot_streak = 0
        self.active_attempt_frame: Optional[int] = None
        self.active_attempt_event_index: Optional[int] = None
        self.awaiting_shot_reset = False
        self.direct_make_detection_active = False
        self.direct_make_streak = 0
        self.recent_direct_make_frames: deque[int] = deque(maxlen=8)
        self.shot_cooldown_frames = max(1, int(self.fps * SHOT_COOLDOWN_SECONDS))
        self.make_cooldown_frames = max(1, int(self.fps * MAKE_COOLDOWN_SECONDS))
        self.post_make_shot_suppression_frames = max(
            2,
            int(self.fps * POST_MAKE_SHOT_SUPPRESSION_SECONDS),
        )
        self.hoop_only_make_duplicate_frames = max(
            2,
            int(self.fps * HOOP_ONLY_MAKE_DUPLICATE_SECONDS),
        )
        self.banner_duration_frames = max(10, int(self.fps * MAKE_BANNER_SECONDS))
        self.attempt_confirmation_frames = max(1, ATTEMPT_CONFIRMATION_FRAMES)
        self.attempt_result_window_frames = max(10, int(self.fps * ATTEMPT_RESULT_WINDOW_SECONDS))
        self.active_attempt_rollover_frames = max(4, int(self.fps * ACTIVE_ATTEMPT_ROLLOVER_SECONDS))
        self.recent_shot_signal_frames = max(3, int(self.fps * RECENT_SHOT_SIGNAL_SECONDS))
        self.recent_basket_memory_frames = max(3, int(self.fps * RECENT_BASKET_MEMORY_SECONDS))
        self.recent_rim_sequence_frames = max(4, int(self.fps * RECENT_RIM_SEQUENCE_SECONDS))
        self.recent_direct_make_frames_window = max(3, int(self.fps * RECENT_DIRECT_MAKE_SECONDS))
        self.recent_basket_pass_frames = max(4, int(self.fps * RECENT_BASKET_PASS_SECONDS))
        self.recent_basket_overlap_frames_window = max(3, int(self.fps * RECENT_BASKET_OVERLAP_SECONDS))
        self.recent_pre_attempt_make_frames = max(4, int(self.fps * RECENT_PRE_ATTEMPT_MAKE_SECONDS))
        self.late_make_recovery_frames = max(4, int(self.fps * LATE_MAKE_RECOVERY_SECONDS))
        self.post_miss_ghost_attempt_frames = max(4, int(self.fps * POST_MISS_GHOST_ATTEMPT_SECONDS))
        self.pending_attempt_finalize_frames = max(4, int(self.fps * PENDING_ATTEMPT_FINALIZE_SECONDS))
        self.recent_ball_positions: deque[tuple[int, tuple[int, int]]] = deque(
            maxlen=max(6, self.recent_rim_sequence_frames * 2)
        )
        self.recent_basket_overlap_frames: deque[int] = deque(maxlen=8)
        self.basket_overlap_streak = 0
        self.last_pre_attempt_make_frame = -10_000
        self.last_hoop_only_make_frame = -10_000
        self.last_miss_frame = -10_000
        self.last_miss_event_index: Optional[int] = None
        self.last_miss_can_recover = False
        self.last_miss_recovery_keeps_active = False
        self.last_rim_entry_frame = -10_000
        self.last_basket_pass_frame = -10_000
        self.shot_events: list[dict[str, object]] = []

    @property
    def misses(self) -> int:
        return self._misses

    @property
    def accuracy(self) -> float:
        if self.attempts == 0:
            return 0.0
        return round((self.makes / self.attempts) * 100.0, 1)

    def to_stats(self) -> dict[str, float | int]:
        return {
            "attempts": self.attempts,
            "makes": self.makes,
            "misses": self.misses,
            "accuracy": self.accuracy,
        }

    def to_shot_events(self) -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        for event in self.shot_events:
            item = event.copy()
            item["evidence"] = list(item.get("evidence") or [])
            events.append(item)
        return events

    def observe(self, detections: list[Dict[str, float | str]], frame_index: int) -> None:
        basket_detection = _best_detection(detections, "basket")
        if basket_detection:
            self.last_basket_center = _detection_center(basket_detection)
            self.last_basket_radius = _basket_make_radius(basket_detection)
            self.last_basket_detection = basket_detection.copy()
            self.last_basket_frame = frame_index

        shot_detection = _best_detection(detections, "player_shooting")
        if shot_detection:
            self.last_shot_signal_frame = frame_index
            if self.awaiting_shot_reset:
                self.pending_shot_streak = 0
            else:
                self.pending_shot_streak += 1
        else:
            self.pending_shot_streak = 0
            self.awaiting_shot_reset = False

        direct_make_detection = _best_detection(detections, "ball_in_basket")
        basket_context = basket_detection or self._recent_basket_detection(frame_index)
        ball_detection = _best_ball_detection(detections, basket_context)
        direct_make_valid = _valid_direct_make_detection(direct_make_detection, basket_context)
        if direct_make_valid:
            self.direct_make_streak += 1
            self.recent_direct_make_frames.append(frame_index)
        else:
            self.direct_make_streak = 0
        self._prune_direct_make_frames(frame_index)
        direct_make_confirmed = self._direct_make_is_confirmed(frame_index)
        single_frame_hoop_make = (
            direct_make_valid
            and basket_context is not None
            and ball_detection is not None
            and float(ball_detection.get("confidence", 0.0)) >= SINGLE_FRAME_HOOP_BALL_CONFIDENCE
            and _ball_overlaps_basket_core(ball_detection, basket_context)
        )

        ball_overlaps_basket_core = False
        tracked_ball = ball_detection or direct_make_detection
        if tracked_ball is not None:
            ball_center = _detection_center(tracked_ball)
            self.recent_ball_positions.append((frame_index, ball_center))
            if basket_context is not None and _ball_enters_rim(
                ball_center,
                basket_context,
                recent_ball_positions=self.recent_ball_positions,
                recent_frame_window=self.recent_rim_sequence_frames,
            ):
                self.last_rim_entry_frame = frame_index
            if (
                basket_context is not None
                and self._recent_rim_entry(frame_index)
                and _ball_under_basket(ball_center, basket_context)
            ):
                self.last_basket_pass_frame = frame_index
            if (
                basket_context is not None
                and ball_detection is not None
                and _ball_overlaps_basket_core(ball_detection, basket_context)
            ):
                ball_overlaps_basket_core = True
                self.recent_basket_overlap_frames.append(frame_index)
        self.basket_overlap_streak = self.basket_overlap_streak + 1 if ball_overlaps_basket_core else 0
        self._prune_basket_overlap_frames(frame_index)

        can_score_make = frame_index - self.last_make_frame >= self.make_cooldown_frames
        basket_overlap_confirmed = self._basket_overlap_is_confirmed(frame_index)
        sustained_basket_overlap_confirmed = self.basket_overlap_streak >= SUSTAINED_BASKET_OVERLAP_FRAMES
        ball_under_basket = (
            basket_context is not None
            and ball_detection is not None
            and _ball_under_basket(_detection_center(ball_detection), basket_context)
        )
        recent_ball_above_rim = (
            basket_context is not None
            and tracked_ball is not None
            and _has_recent_ball_above_rim(
                basket_context,
                recent_ball_positions=self.recent_ball_positions,
                current_frame=frame_index,
                recent_frame_window=self.recent_rim_sequence_frames,
            )
        )
        basket_overlap_pass_confirmed = basket_overlap_confirmed and (
            self._recent_basket_pass(frame_index) or ball_under_basket
        )
        shot_release_evidence = (
            basket_context is not None
            and ball_detection is not None
            and self._recent_shot_signal(frame_index)
            and _ball_above_rim(_detection_center(ball_detection), basket_context)
        )
        hoop_make_confirmed = (
            basket_overlap_pass_confirmed
            or self._recent_basket_pass(frame_index)
        )
        current_hoop_make_evidence = hoop_make_confirmed
        attempt_evidence = _attempt_evidence(
            shot_signal=self._recent_shot_signal(frame_index),
            basket_visible=basket_context is not None,
            ball_visible=ball_detection is not None,
            release_seen=shot_release_evidence,
        )
        make_evidence = _make_evidence(
            direct_make_confirmed=direct_make_confirmed,
            basket_overlap_pass_confirmed=basket_overlap_pass_confirmed,
            sustained_basket_overlap_confirmed=sustained_basket_overlap_confirmed,
            single_frame_hoop_make=single_frame_hoop_make,
            recent_basket_pass=self._recent_basket_pass(frame_index),
            recent_pre_attempt_make=self._recent_pre_attempt_make(frame_index),
            basket_visible=basket_context is not None,
            ball_visible=ball_detection is not None or direct_make_detection is not None,
        )

        if self._should_rollover_active_attempt(frame_index) and not current_hoop_make_evidence:
            miss_evidence = _miss_evidence(
                "new shot started before prior result",
                basket_visible=basket_context is not None,
                ball_visible=ball_detection is not None,
                shot_signal=True,
            )
            self._resolve_attempt(
                frame_index,
                made=False,
                banner_text="Miss recorded",
                recovery_keeps_active=True,
                evidence=miss_evidence,
                result_reason=_shot_result_reason(False, miss_evidence),
                result_quality=_shot_result_quality(False, miss_evidence),
            )
            self._start_attempt(frame_index, "Shot attempt detected", evidence=attempt_evidence)

        if (
            self.active_attempt_frame is None
            and not current_hoop_make_evidence
            and (self.pending_shot_streak >= self.attempt_confirmation_frames or shot_release_evidence)
            and shot_release_evidence
            and frame_index - self.last_attempt_frame >= self.shot_cooldown_frames
            and not self._recent_make_duplicate_shot(frame_index)
            and frame_index - self.last_hoop_only_make_frame >= self.make_cooldown_frames
        ):
            self._start_attempt(frame_index, "Shot attempt detected", evidence=attempt_evidence)
            self.pending_shot_streak = 0

        if (
            can_score_make
            and self.active_attempt_frame is None
            and not self._recent_make_duplicate_hoop_only(frame_index)
            and hoop_make_confirmed
            and (direct_make_confirmed or self._recent_shot_signal(frame_index))
        ):
            self.last_pre_attempt_make_frame = frame_index
            self.last_hoop_only_make_frame = frame_index
            self._start_attempt(frame_index, "Made basket detected", evidence=_unique_evidence(["hoop result detected before shooting pose"] + make_evidence))

        if (
            can_score_make
            and self.active_attempt_frame is None
            and not self._recent_make_duplicate_hoop_only(frame_index)
            and direct_make_valid
            and self._recent_basket_pass(frame_index)
            and (direct_make_confirmed or self._recent_shot_signal(frame_index))
        ):
            self.last_pre_attempt_make_frame = frame_index
            self.last_hoop_only_make_frame = frame_index
            self._start_attempt(frame_index, "Made basket detected", evidence=_unique_evidence(["hoop result detected before shooting pose"] + make_evidence))

        recovered_late_make = False
        if can_score_make and (
            self._recent_basket_pass(frame_index)
            or basket_overlap_pass_confirmed
        ):
            recovered_late_make = self._recover_recent_miss_as_make(frame_index, evidence=make_evidence)

        if (
            can_score_make
            and not recovered_late_make
            and self.active_attempt_frame is not None
            and (
                self._recent_basket_pass(frame_index)
                or basket_overlap_pass_confirmed
                or self._recent_pre_attempt_make(frame_index)
            )
        ):
            self.makes += 1
            self.last_make_frame = frame_index
            self._resolve_attempt(
                frame_index,
                made=True,
                banner_text="Made basket detected",
                evidence=make_evidence,
                result_reason=_shot_result_reason(True, make_evidence),
                result_quality=_shot_result_quality(True, make_evidence),
            )
        self.direct_make_detection_active = direct_make_detection is not None

        if (
            self.active_attempt_frame is not None
            and frame_index - self.active_attempt_frame >= self.attempt_result_window_frames
        ):
            miss_evidence = _miss_evidence(
                "result window expired",
                basket_visible=basket_context is not None,
                ball_visible=ball_detection is not None,
                shot_signal=self._recent_shot_signal(frame_index),
            )
            self._resolve_attempt(
                frame_index,
                made=False,
                banner_text="Miss recorded",
                evidence=miss_evidence,
                result_reason=_shot_result_reason(False, miss_evidence),
                result_quality=_shot_result_quality(False, miss_evidence),
            )

    def _set_banner(self, text: str, frame_index: int) -> None:
        self.banner_text = text
        self.banner_until_frame = frame_index + self.banner_duration_frames

    def banner_is_active(self, frame_index: int) -> bool:
        return frame_index <= self.banner_until_frame

    def _recent_shot_signal(self, frame_index: int) -> bool:
        return frame_index - self.last_shot_signal_frame <= self.recent_shot_signal_frames

    def _recent_basket_detection(self, frame_index: int) -> Optional[Dict[str, float | str]]:
        if (
            self.last_basket_detection is None
            or frame_index - self.last_basket_frame > self.recent_basket_memory_frames
        ):
            return None
        return self.last_basket_detection

    def _recent_rim_entry(self, frame_index: int) -> bool:
        return frame_index - self.last_rim_entry_frame <= self.recent_rim_sequence_frames

    def _recent_basket_pass(self, frame_index: int) -> bool:
        return frame_index - self.last_basket_pass_frame <= self.recent_basket_pass_frames

    def _direct_make_is_confirmed(self, frame_index: int) -> bool:
        self._prune_direct_make_frames(frame_index)
        return len(self.recent_direct_make_frames) >= DIRECT_MAKE_CONFIRMATION_FRAMES

    def _prune_direct_make_frames(self, frame_index: int) -> None:
        while (
            self.recent_direct_make_frames
            and frame_index - self.recent_direct_make_frames[0] > self.recent_direct_make_frames_window
        ):
            self.recent_direct_make_frames.popleft()

    def _basket_overlap_is_confirmed(self, frame_index: int) -> bool:
        self._prune_basket_overlap_frames(frame_index)
        return len(self.recent_basket_overlap_frames) >= BASKET_OVERLAP_CONFIRMATION_FRAMES

    def _recent_pre_attempt_make(self, frame_index: int) -> bool:
        return frame_index - self.last_pre_attempt_make_frame <= self.recent_pre_attempt_make_frames

    def _recent_make_duplicate_shot(self, frame_index: int) -> bool:
        return frame_index - self.last_make_frame < self.post_make_shot_suppression_frames

    def _recent_make_duplicate_hoop_only(self, frame_index: int) -> bool:
        return frame_index - self.last_make_frame < self.hoop_only_make_duplicate_frames

    def _should_rollover_active_attempt(self, frame_index: int) -> bool:
        if self.active_attempt_frame is None:
            return False
        if self.pending_shot_streak < self.attempt_confirmation_frames:
            return False
        if frame_index - self.active_attempt_frame < self.active_attempt_rollover_frames:
            return False
        if frame_index - self.last_attempt_frame < self.shot_cooldown_frames:
            return False
        if self._recent_rim_entry(frame_index) or self._recent_basket_pass(frame_index):
            return False
        return True

    def _recover_recent_miss_as_make(self, frame_index: int, *, evidence: Optional[list[str]] = None) -> bool:
        if (
            self.misses <= 0
            or not self.last_miss_can_recover
            or frame_index - self.last_miss_frame > self.late_make_recovery_frames
        ):
            return False
        if (
            self.active_attempt_frame is not None
            and self.active_attempt_frame - self.last_miss_frame > self.post_miss_ghost_attempt_frames
        ):
            return False

        recovery_keeps_active = self.last_miss_recovery_keeps_active
        drop_active_event = self.active_attempt_frame is not None and not recovery_keeps_active

        self._misses -= 1
        if drop_active_event:
            self.attempts = max(0, self.attempts - 1)
        self.makes += 1
        self.last_make_frame = frame_index
        self.last_miss_frame = -10_000
        self.last_miss_can_recover = False
        self.last_miss_recovery_keeps_active = False
        self.pending_shot_streak = 0
        recovery_evidence = _unique_evidence(["late make recovered after rim bounce"] + list(evidence or []))
        if self.last_miss_event_index is not None and 0 <= self.last_miss_event_index < len(self.shot_events):
            existing_evidence = list(self.shot_events[self.last_miss_event_index].get("evidence") or [])
            combined_evidence = _unique_evidence(existing_evidence + recovery_evidence)
            self.shot_events[self.last_miss_event_index].update(
                {
                    "result": "make",
                    "result_frame": frame_index,
                    "result_timestamp_seconds": round(frame_index / self.fps, 2),
                    "result_quality": _shot_result_quality(True, combined_evidence),
                    "result_reason": _shot_result_reason(True, combined_evidence),
                    "evidence": combined_evidence,
                }
            )
        if drop_active_event:
            if self.active_attempt_event_index is not None:
                self._remove_shot_event(self.active_attempt_event_index)
            self.active_attempt_event_index = None
            self.active_attempt_frame = None
        self.recent_basket_overlap_frames.clear()
        self.basket_overlap_streak = 0
        self.last_pre_attempt_make_frame = -10_000
        self.last_hoop_only_make_frame = frame_index
        self.last_rim_entry_frame = -10_000
        self.last_basket_pass_frame = -10_000
        self.last_miss_event_index = None
        self._set_banner("Made basket detected", frame_index)
        return True

    def _prune_basket_overlap_frames(self, frame_index: int) -> None:
        while (
            self.recent_basket_overlap_frames
            and frame_index - self.recent_basket_overlap_frames[0] > self.recent_basket_overlap_frames_window
        ):
            self.recent_basket_overlap_frames.popleft()

    def _start_attempt(self, frame_index: int, banner_text: str, *, evidence: Optional[list[str]] = None) -> None:
        self.attempts += 1
        self.last_attempt_frame = frame_index
        self.active_attempt_frame = frame_index
        self.active_attempt_event_index = len(self.shot_events)
        attempt_evidence = _unique_evidence(evidence or [])
        self.shot_events.append(
            {
                "shot_number": self.attempts,
                "result": "pending",
                "start_frame": frame_index,
                "timestamp_seconds": round(frame_index / self.fps, 2),
                "result_quality": None,
                "result_reason": "Attempt detected; waiting for hoop result.",
                "evidence": attempt_evidence,
            }
        )
        self.awaiting_shot_reset = True
        self.recent_basket_overlap_frames.clear()
        self.basket_overlap_streak = 0
        self.last_rim_entry_frame = -10_000
        self.last_basket_pass_frame = -10_000
        self._set_banner(banner_text, frame_index)

    def _resolve_attempt(
        self,
        frame_index: int,
        made: bool,
        banner_text: str,
        *,
        allow_late_recovery: bool = True,
        recovery_keeps_active: bool = False,
        evidence: Optional[list[str]] = None,
        result_reason: Optional[str] = None,
        result_quality: Optional[str] = None,
    ) -> None:
        if self.active_attempt_frame is None:
            return
        event_index = self.active_attempt_event_index
        if event_index is not None and 0 <= event_index < len(self.shot_events):
            existing_evidence = list(self.shot_events[event_index].get("evidence") or [])
            combined_evidence = _unique_evidence(existing_evidence + list(evidence or []))
            self.shot_events[event_index].update(
                {
                    "result": "make" if made else "miss",
                    "result_frame": frame_index,
                    "result_timestamp_seconds": round(frame_index / self.fps, 2),
                    "result_quality": result_quality or _shot_result_quality(made, combined_evidence),
                    "result_reason": result_reason or _shot_result_reason(made, combined_evidence),
                    "evidence": combined_evidence,
                }
            )
        if not made:
            self._misses += 1
            self.last_miss_frame = frame_index
            self.last_miss_event_index = event_index
            self.last_miss_can_recover = allow_late_recovery
            self.last_miss_recovery_keeps_active = recovery_keeps_active
        else:
            self.last_miss_event_index = None
        self.active_attempt_frame = None
        self.active_attempt_event_index = None
        self.pending_shot_streak = 0
        self.recent_basket_overlap_frames.clear()
        self.basket_overlap_streak = 0
        self.last_pre_attempt_make_frame = -10_000
        self.last_rim_entry_frame = -10_000
        self.last_basket_pass_frame = -10_000
        self._set_banner(banner_text, frame_index)

    def discard_pending_attempt(self) -> None:
        if self.active_attempt_frame is None:
            return
        self.attempts = max(0, self.attempts - 1)
        if self.active_attempt_event_index is not None:
            self._remove_shot_event(self.active_attempt_event_index)
        self.active_attempt_frame = None
        self.active_attempt_event_index = None
        self.pending_shot_streak = 0
        self.recent_basket_overlap_frames.clear()
        self.basket_overlap_streak = 0
        self.last_pre_attempt_make_frame = -10_000
        self.last_rim_entry_frame = -10_000
        self.last_basket_pass_frame = -10_000

    def finalize_pending_attempt(self, final_frame_index: int) -> None:
        if self.active_attempt_frame is None:
            return
        if final_frame_index - self.active_attempt_frame >= self.pending_attempt_finalize_frames:
            evidence = _miss_evidence("clip ended before clear hoop result")
            self._resolve_attempt(
                final_frame_index,
                made=False,
                banner_text="Miss recorded",
                evidence=evidence,
                result_reason=_shot_result_reason(False, evidence),
                result_quality=_shot_result_quality(False, evidence),
            )
            return
        self.discard_pending_attempt()

    def _remove_shot_event(self, event_index: int) -> None:
        if 0 <= event_index < len(self.shot_events):
            self.shot_events.pop(event_index)
            self._renumber_shot_events()
        self.last_miss_event_index = None

    def _renumber_shot_events(self) -> None:
        for index, event in enumerate(self.shot_events, start=1):
            event["shot_number"] = index


def _unique_evidence(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _attempt_evidence(
    *,
    shot_signal: bool,
    basket_visible: bool,
    ball_visible: bool,
    release_seen: bool,
) -> list[str]:
    evidence: list[str] = []
    if shot_signal:
        evidence.append("shooting motion detected")
    if basket_visible:
        evidence.append("basket visible")
    if ball_visible:
        evidence.append("ball visible")
    if release_seen:
        evidence.append("ball above rim at release")
    return _unique_evidence(evidence)


def _make_evidence(
    *,
    direct_make_confirmed: bool,
    basket_overlap_pass_confirmed: bool,
    sustained_basket_overlap_confirmed: bool,
    single_frame_hoop_make: bool,
    recent_basket_pass: bool,
    recent_pre_attempt_make: bool,
    basket_visible: bool,
    ball_visible: bool,
) -> list[str]:
    evidence: list[str] = []
    if basket_visible:
        evidence.append("basket visible")
    if ball_visible:
        evidence.append("ball visible")
    if direct_make_confirmed:
        evidence.append("ball-in-basket confirmed across frames")
    if basket_overlap_pass_confirmed:
        evidence.append("ball entered hoop and passed below rim")
    if sustained_basket_overlap_confirmed:
        evidence.append("ball overlapped basket core across frames")
    if single_frame_hoop_make:
        evidence.append("single-frame hoop confirmation")
    if recent_basket_pass:
        evidence.append("recent ball path under basket")
    if recent_pre_attempt_make:
        evidence.append("recent hoop result before attempt")
    return _unique_evidence(evidence)


def _miss_evidence(
    reason: str,
    *,
    basket_visible: bool = False,
    ball_visible: bool = False,
    shot_signal: bool = False,
) -> list[str]:
    evidence = [reason]
    if shot_signal:
        evidence.append("shooting motion detected")
    if basket_visible:
        evidence.append("basket visible")
    if ball_visible:
        evidence.append("ball visible")
    evidence.append("no confirmed ball-through-hoop result")
    return _unique_evidence(evidence)


def _shot_result_quality(made: bool, evidence: list[str]) -> str:
    evidence_set = set(evidence)
    if made:
        if (
            "ball entered hoop and passed below rim" in evidence_set
            and (
                "ball-in-basket confirmed across frames" in evidence_set
                or "recent ball path under basket" in evidence_set
            )
        ):
            return "high"
        if (
            "recent ball path under basket" in evidence_set
            and "basket visible" in evidence_set
            and "ball visible" in evidence_set
        ):
            return "high"
        if (
            "ball-in-basket confirmed across frames" in evidence_set
            or "ball overlapped basket core across frames" in evidence_set
            or "recent ball path under basket" in evidence_set
        ):
            return "medium"
        return "low"

    if (
        "result window expired" in evidence_set
        and "shooting motion detected" in evidence_set
        and "basket visible" in evidence_set
    ):
        return "medium"
    return "low"


def _shot_result_reason(made: bool, evidence: list[str]) -> str:
    evidence_set = set(evidence)
    if made:
        if "late make recovered after rim bounce" in evidence_set:
            return "Recovered as a make because a late hoop result appeared after the miss window."
        if "ball entered hoop and passed below rim" in evidence_set:
            return "Counted as a make because the ball entered the hoop area and continued below the rim."
        if "recent ball path under basket" in evidence_set:
            return "Counted as a make because the ball was tracked below the basket after rim entry."
        if "ball-in-basket confirmed across frames" in evidence_set:
            return "Counted as a make because the ball-in-basket detection was confirmed across frames."
        if "ball overlapped basket core across frames" in evidence_set:
            return "Counted as a make because the ball stayed inside the basket core across frames."
        if "single-frame hoop confirmation" in evidence_set:
            return "Counted as a make from a single clear hoop confirmation with the ball inside the rim."
        return "Counted as a make from available hoop-entry evidence."

    if "new shot started before prior result" in evidence_set:
        return "Counted as a miss because a new shot started before the previous attempt had a confirmed hoop result."
    if "clip ended before clear hoop result" in evidence_set:
        return "Counted as a miss because the clip ended before a clear hoop result was confirmed."
    return "Counted as a miss because the result window ended without confirmed ball-through-hoop evidence."


class ShotTrainingJob:
    def __init__(
        self,
        file_id: str,
        detector: BallDetector,
        input_path: Path,
        output_path: Path,
        overlay_mode: str,
        test_mode: bool,
        user_key: str,
        source_orientation: str = "auto",
    ) -> None:
        self.file_id = file_id
        self.detector = detector
        self.input_path = input_path
        self.output_path = output_path
        self.overlay_mode = overlay_mode
        self.test_mode = test_mode
        self.user_key = user_key
        self.source_orientation = _normalize_source_orientation(source_orientation)

    def run(self) -> None:
        capture = cv2.VideoCapture(str(self.input_path))
        writer: Optional[AnnotatedVideoWriter] = None
        try:
            if not capture.isOpened():
                raise RuntimeError("Unable to open the selected video.")

            fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
            encoded_frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            encoded_frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            max_frames = total_frames
            if max_frames <= 0:
                max_frames = int(fps * (TEST_MODE_SECONDS if self.test_mode else MAX_VIDEO_SECONDS))
            else:
                duration_limit = TEST_MODE_SECONDS if self.test_mode else MAX_VIDEO_SECONDS
                max_frames = min(max_frames, int(fps * duration_limit))

            if encoded_frame_width <= 0 or encoded_frame_height <= 0:
                raise RuntimeError("Unable to read the selected video's frame size.")

            auto_orientation_enabled = _enable_capture_auto_orientation(capture)
            orientation_degrees = _read_capture_orientation(capture)

            success, first_frame = capture.read()
            if not success or first_frame is None:
                raise RuntimeError("Unable to read frames from the selected video.")

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

            tracker = ShotTrainingTracker(fps)
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
                stats=tracker.to_stats(),
                shot_events=tracker.to_shot_events(),
            )

            frame_index = 0
            player_frames = 0
            ball_frames = 0
            shot_signal_frames = 0
            frame = first_frame
            while frame_index < max_frames:
                _raise_if_cancelled(self.file_id)

                detections = self.detector.detect_training_objects(
                    frame,
                    confidence_overrides=SHOT_TRAINING_CONFIDENCE_OVERRIDES,
                )
                if _best_detection(detections, "player") or _best_detection(detections, "player_shooting"):
                    player_frames += 1
                if _best_detection(detections, "ball") or _best_detection(detections, "ball_in_basket"):
                    ball_frames += 1
                if _best_detection(detections, "player_shooting"):
                    shot_signal_frames += 1
                tracker.observe(detections, frame_index)

                annotated = frame.copy()
                self._draw_frame(
                    annotated,
                    detections=detections,
                    tracker=tracker,
                    frame_index=frame_index,
                )
                writer.write(annotated)

                frame_index += 1
                if frame_index % 10 == 0 or frame_index == max_frames:
                    _update_job(
                        self.file_id,
                        status="processing",
                        processed_frames=frame_index,
                        total_frames=max_frames,
                        progress_percentage=int((frame_index / max(max_frames, 1)) * 100),
                        output_width=frame_width,
                        output_height=frame_height,
                        output_orientation=output_orientation,
                        stats=tracker.to_stats(),
                        shot_events=tracker.to_shot_events(),
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
            tracker.finalize_pending_attempt(frame_index)

            classification = classify_score(tracker.accuracy)
            warning = _shot_training_validity_warning(
                processed_frames=frame_index,
                player_frames=player_frames,
                ball_frames=ball_frames,
                shot_signal_frames=shot_signal_frames,
                attempts=tracker.attempts,
            )
            summary = (
                f"Shot training finished with {tracker.attempts} attempts, {tracker.makes} makes, "
                f"and {tracker.accuracy:.1f}% shooting accuracy."
            )
            if warning:
                summary = f"{warning} {summary}"
                classification = "Poor"
            append_session_history(
                {
                    "session_id": self.file_id,
                    "mode": "shot_training",
                    "timestamp": now_utc().isoformat(),
                    "score": tracker.accuracy,
                    "classification": classification,
                    "summary": summary,
                    "action_count": tracker.attempts,
                    "action_label": "Shots",
                    "shooting_stats": tracker.to_stats(),
                    "shot_events": tracker.to_shot_events(),
                    "source_type": "shot_training_video",
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
                stats=tracker.to_stats(),
                shot_events=tracker.to_shot_events(),
                summary=summary,
                classification=classification,
            )
        except ShotTrainingCancelled:
            _update_job(
                self.file_id,
                status="cancelled",
                error_message=None,
                summary="Shot training analysis was cancelled.",
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

    def _draw_frame(
        self,
        frame: np.ndarray,
        detections: list[Dict[str, float | str]],
        tracker: ShotTrainingTracker,
        frame_index: int,
    ) -> None:
        if self.overlay_mode == "full_tracking":
            for detection in detections:
                _draw_detection_box(frame, detection)

        if self.overlay_mode in {"full_tracking", "focus_stats"} and tracker.banner_is_active(frame_index):
            _draw_make_banner(frame, tracker.banner_text)

        _draw_scoreboard(frame, tracker)
        if self.overlay_mode != "stats_only":
            _draw_frame_footer(frame, self.overlay_mode, self.test_mode)


def start_shot_training_job(
    detector: BallDetector,
    video: UploadFile,
    overlay_mode: str,
    test_mode: bool,
    user_key: str,
    source_orientation: str = "auto",
) -> dict[str, object]:
    ensure_shot_training_dirs()

    file_id = uuid.uuid4().hex
    suffix = Path(video.filename or "shot-training.mp4").suffix or ".mp4"
    input_path = SHOT_TRAINING_UPLOADS_DIR / f"{file_id}{suffix}"
    output_path = SHOT_TRAINING_OUTPUTS_DIR / f"{file_id}_annotated.mp4"

    with input_path.open("wb") as output_file:
        output_file.write(video.file.read())

    with shot_training_lock:
        shot_training_jobs[file_id] = {
            "file_id": file_id,
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
            "stats": {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
            "shot_events": [],
            "classification": None,
            "summary": None,
            "error_message": None,
            "cancel_requested": False,
            "user_key": user_key,
        }

    worker = ShotTrainingJob(
        file_id=file_id,
        detector=detector,
        input_path=input_path,
        output_path=output_path,
        overlay_mode=overlay_mode,
        test_mode=test_mode,
        user_key=user_key,
        source_orientation=source_orientation,
    )
    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()
    return shot_training_jobs[file_id].copy()


def get_shot_training_status(file_id: str) -> dict[str, object]:
    with shot_training_lock:
        job = shot_training_jobs.get(file_id)
        if not job:
            return {
                "file_id": file_id,
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
                "stats": {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
                "shot_events": [],
                "classification": None,
                "summary": None,
                "error_message": None,
            }
        return job.copy()


def cancel_shot_training_job(file_id: str) -> dict[str, object]:
    with shot_training_lock:
        job = shot_training_jobs.get(file_id)
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
        job["summary"] = "Shot training analysis was cancelled."
        shot_training_jobs[file_id] = job
        return job.copy()


def get_shot_training_output_path(file_id: str) -> Optional[Path]:
    output_path = SHOT_TRAINING_OUTPUTS_DIR / f"{file_id}_annotated.mp4"
    if output_path.exists():
        return output_path
    return None


def _update_job(file_id: str, **updates: object) -> None:
    with shot_training_lock:
        current = shot_training_jobs.get(file_id, {}).copy()
        current.update(updates)
        shot_training_jobs[file_id] = current


def _raise_if_cancelled(file_id: str) -> None:
    with shot_training_lock:
        job = shot_training_jobs.get(file_id, {})
        if job.get("cancel_requested") or job.get("status") == "cancelled":
            raise ShotTrainingCancelled()


def _best_detection(
    detections: list[Dict[str, float | str]],
    label: str,
) -> Optional[Dict[str, float | str]]:
    matching = [item for item in detections if item.get("label") == label]
    if not matching:
        return None
    return max(matching, key=lambda item: float(item.get("confidence", 0.0)))


def _best_ball_detection(
    detections: list[Dict[str, float | str]],
    basket_detection: Optional[Dict[str, float | str]],
) -> Optional[Dict[str, float | str]]:
    matching = [item for item in detections if item.get("label") == "ball"]
    if not matching:
        return None
    if basket_detection is None:
        return max(matching, key=lambda item: float(item.get("confidence", 0.0)))

    basket_center = _detection_center(basket_detection)
    basket_width = abs(float(basket_detection["x2"]) - float(basket_detection["x1"]))
    basket_height = abs(float(basket_detection["y2"]) - float(basket_detection["y1"]))
    basket_scale = max(1.0, basket_width, basket_height)

    def score(item: Dict[str, float | str]) -> float:
        center = _detection_center(item)
        distance = _point_distance(center, basket_center)
        confidence = float(item.get("confidence", 0.0))
        return distance / basket_scale - confidence * 0.20

    return min(matching, key=score)


def _valid_direct_make_detection(
    direct_make_detection: Optional[Dict[str, float | str]],
    basket_detection: Optional[Dict[str, float | str]],
) -> bool:
    if direct_make_detection is None or basket_detection is None:
        return False
    return _detection_overlaps_basket_area(direct_make_detection, basket_detection)


def _detection_overlaps_basket_area(
    detection: Dict[str, float | str],
    basket_detection: Dict[str, float | str],
) -> bool:
    basket_x1 = float(basket_detection["x1"])
    basket_y1 = float(basket_detection["y1"])
    basket_x2 = float(basket_detection["x2"])
    basket_y2 = float(basket_detection["y2"])
    basket_width = max(1.0, basket_x2 - basket_x1)
    basket_height = max(1.0, basket_y2 - basket_y1)
    expanded_basket = {
        "x1": basket_x1 - basket_width * 0.20,
        "y1": basket_y1 - basket_height * 0.20,
        "x2": basket_x2 + basket_width * 0.20,
        "y2": basket_y2 + basket_height * 0.45,
    }
    detection_x1 = float(detection["x1"])
    detection_y1 = float(detection["y1"])
    detection_x2 = float(detection["x2"])
    detection_y2 = float(detection["y2"])
    overlaps = not (
        detection_x2 < expanded_basket["x1"]
        or detection_x1 > expanded_basket["x2"]
        or detection_y2 < expanded_basket["y1"]
        or detection_y1 > expanded_basket["y2"]
    )
    if overlaps:
        return True

    detection_center = _detection_center(detection)
    return (
        expanded_basket["x1"] <= detection_center[0] <= expanded_basket["x2"]
        and expanded_basket["y1"] <= detection_center[1] <= expanded_basket["y2"]
    )


def _ball_overlaps_basket_core(
    ball_detection: Dict[str, float | str],
    basket_detection: Dict[str, float | str],
) -> bool:
    overlap_area = _intersection_area(ball_detection, basket_detection)
    ball_area = _detection_area(ball_detection)
    if ball_area <= 0:
        return False
    return overlap_area / ball_area >= 0.18


def _intersection_area(
    first: Dict[str, float | str],
    second: Dict[str, float | str],
) -> float:
    x1 = max(float(first["x1"]), float(second["x1"]))
    y1 = max(float(first["y1"]), float(second["y1"]))
    x2 = min(float(first["x2"]), float(second["x2"]))
    y2 = min(float(first["y2"]), float(second["y2"]))
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _detection_area(detection: Dict[str, float | str]) -> float:
    return max(0.0, float(detection["x2"]) - float(detection["x1"])) * max(
        0.0,
        float(detection["y2"]) - float(detection["y1"]),
    )


def _ball_enters_rim(
    ball_center: tuple[int, int],
    basket_detection: Dict[str, float | str],
    *,
    recent_ball_positions: deque[tuple[int, tuple[int, int]]],
    recent_frame_window: int,
) -> bool:
    if not _ball_in_rim_window(ball_center, basket_detection):
        return False
    return _has_recent_ball_above_rim(
        basket_detection,
        recent_ball_positions=recent_ball_positions,
        current_frame=recent_ball_positions[-1][0],
        recent_frame_window=recent_frame_window,
    )


def _has_recent_ball_above_rim(
    basket_detection: Dict[str, float | str],
    *,
    recent_ball_positions: deque[tuple[int, tuple[int, int]]],
    current_frame: int,
    recent_frame_window: int,
) -> bool:
    for sample_frame, sample_center in reversed(recent_ball_positions):
        if current_frame - sample_frame > recent_frame_window:
            break
        if _ball_above_rim(sample_center, basket_detection):
            return True
    return False


def _ball_in_rim_window(ball_center: tuple[int, int], basket_detection: Dict[str, float | str]) -> bool:
    rim_zone = _rim_zone(basket_detection)
    return (
        rim_zone["inner_x1"] <= ball_center[0] <= rim_zone["inner_x2"]
        and rim_zone["entry_y1"] <= ball_center[1] <= rim_zone["entry_y2"]
    )


def _ball_above_rim(ball_center: tuple[int, int], basket_detection: Dict[str, float | str]) -> bool:
    rim_zone = _rim_zone(basket_detection)
    return (
        rim_zone["outer_x1"] <= ball_center[0] <= rim_zone["outer_x2"]
        and ball_center[1] < rim_zone["entry_y1"]
    )


def _ball_under_basket(ball_center: tuple[int, int], basket_detection: Dict[str, float | str]) -> bool:
    rim_zone = _rim_zone(basket_detection)
    return (
        rim_zone["under_x1"] <= ball_center[0] <= rim_zone["under_x2"]
        and rim_zone["under_y1"] <= ball_center[1] <= rim_zone["under_y2"]
    )


def _rim_zone(basket_detection: Dict[str, float | str]) -> dict[str, float]:
    basket_x1 = float(basket_detection["x1"])
    basket_y1 = float(basket_detection["y1"])
    basket_x2 = float(basket_detection["x2"])
    basket_y2 = float(basket_detection["y2"])
    basket_width = max(1.0, basket_x2 - basket_x1)
    basket_height = max(1.0, basket_y2 - basket_y1)
    return {
        "inner_x1": basket_x1 + basket_width * 0.24,
        "inner_x2": basket_x2 - basket_width * 0.24,
        "outer_x1": basket_x1 + basket_width * 0.10,
        "outer_x2": basket_x2 - basket_width * 0.10,
        "entry_y1": basket_y1 + basket_height * 0.10,
        "entry_y2": basket_y1 + basket_height * 0.58,
        "under_x1": basket_x1 - basket_width * 0.25,
        "under_x2": basket_x2 + basket_width * 0.25,
        "under_y1": basket_y1 + basket_height * 0.72,
        "under_y2": basket_y2 + basket_height * 1.60,
    }


def _infer_make_detection(
    detections: list[Dict[str, float | str]],
    *,
    basket_detection: Optional[Dict[str, float | str]],
    last_basket_center: Optional[tuple[int, int]],
    last_basket_radius: float,
) -> Optional[Dict[str, float | str]]:
    ball_detection = _best_detection(detections, "ball")
    if ball_detection is None:
        return None

    if basket_detection is not None and _ball_in_rim_window(_detection_center(ball_detection), basket_detection):
        inferred = ball_detection.copy()
        inferred["label"] = "ball_in_basket"
        inferred["display_label"] = "Ball In Basket"
        return inferred

    if last_basket_center is not None and last_basket_radius > 0:
        ball_center = _detection_center(ball_detection)
        if _point_distance(ball_center, last_basket_center) <= max(18.0, last_basket_radius * 0.4):
            inferred = ball_detection.copy()
            inferred["label"] = "ball_in_basket"
            inferred["display_label"] = "Ball In Basket"
            return inferred

    return None


def _ball_overlaps_basket(ball_detection: Dict[str, float | str], basket_detection: Dict[str, float | str]) -> bool:
    return _ball_in_rim_window(_detection_center(ball_detection), basket_detection)


def _basket_make_radius(basket_detection: Dict[str, float | str]) -> float:
    width = abs(float(basket_detection["x2"]) - float(basket_detection["x1"]))
    height = abs(float(basket_detection["y2"]) - float(basket_detection["y1"]))
    return max(18.0, max(width, height) * 0.35)


def _point_distance(first: tuple[int, int], second: tuple[int, int]) -> float:
    return ((first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2) ** 0.5


def _shot_training_validity_warning(
    *,
    processed_frames: int,
    player_frames: int,
    ball_frames: int,
    shot_signal_frames: int,
    attempts: int,
) -> Optional[str]:
    if processed_frames <= 0:
        return "No usable video frames were found."

    player_ratio = player_frames / processed_frames
    ball_ratio = ball_frames / processed_frames
    shot_signal_ratio = shot_signal_frames / processed_frames

    if player_ratio < 0.05 and ball_ratio < 0.05:
        return "No valid shooting action detected. Make sure a player and basketball are visible."
    if player_ratio < 0.05:
        return "No player detected. Make sure the shooter is fully visible."
    if ball_ratio < 0.05:
        return "No basketball detected. Keep the ball visible through the shot."
    if attempts <= 0 and shot_signal_ratio < 0.05:
        return "No shot attempt detected. Upload a clip where the player actually shoots the ball."
    if attempts <= 0:
        return "No completed shot attempt was counted. Keep the shooter, ball, and rim visible."
    return None


def _detection_center(detection: Dict[str, float | str]) -> tuple[int, int]:
    x1 = int(float(detection["x1"]))
    y1 = int(float(detection["y1"]))
    x2 = int(float(detection["x2"]))
    y2 = int(float(detection["y2"]))
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def _draw_detection_box(frame: np.ndarray, detection: Dict[str, float | str]) -> None:
    label = str(detection["label"])
    display_label = str(detection.get("display_label") or label.replace("_", " ").title())
    confidence = float(detection["confidence"])
    x1 = int(float(detection["x1"]))
    y1 = int(float(detection["y1"]))
    x2 = int(float(detection["x2"]))
    y2 = int(float(detection["y2"]))
    color = SHOT_TRAINING_COLORS.get(label, (255, 255, 255))

    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    cv2.putText(
        frame,
        f"{display_label} {confidence:.2f}",
        (x1, max(18, y1 - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        color,
        2,
        cv2.LINE_AA,
    )


def _draw_make_banner(frame: np.ndarray, text: str) -> None:
    height, width = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (18, 18), (width - 18, 76), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)
    cv2.putText(
        frame,
        text,
        (32, 56),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.85,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )


def _draw_scoreboard(frame: np.ndarray, tracker: ShotTrainingTracker) -> None:
    height, width = frame.shape[:2]
    landscape = width > height
    panel_width = min(width - 32, 520 if landscape else 360)
    panel_height = 82 if landscape else 110
    x = 16
    y = max(16, height - panel_height - 16)
    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + panel_width, y + panel_height), (18, 22, 34), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (x, y), (x + panel_width, y + panel_height), (20, 105, 255), 2)

    if landscape:
        _draw_stat(frame, "ATTEMPTS", str(tracker.attempts), x + 18, y + 24, (255, 255, 255), value_scale=0.72)
        _draw_stat(frame, "MAKES", str(tracker.makes), x + 142, y + 24, (60, 220, 100), value_scale=0.72)
        _draw_stat(frame, "MISSES", str(tracker.misses), x + 242, y + 24, (255, 180, 80), value_scale=0.72)
        cv2.putText(
            frame,
            f"ACC {tracker.accuracy:.1f}%",
            (x + 356, y + 54),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.68,
            (0, 255, 255),
            2,
            cv2.LINE_AA,
        )
        return

    _draw_stat(frame, "ATTEMPTS", str(tracker.attempts), x + 18, y + 30, (255, 255, 255))
    _draw_stat(frame, "MAKES", str(tracker.makes), x + 140, y + 30, (60, 220, 100))
    _draw_stat(frame, "MISSES", str(tracker.misses), x + 230, y + 30, (255, 180, 80))

    cv2.putText(
        frame,
        f"ACCURACY {tracker.accuracy:.1f}%",
        (x + 18, y + 88),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )


def _draw_stat(
    frame: np.ndarray,
    label: str,
    value: str,
    x: int,
    y: int,
    color: tuple[int, int, int],
    value_scale: float = 0.88,
) -> None:
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (165, 175, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, value, (x, y + 28), cv2.FONT_HERSHEY_SIMPLEX, value_scale, color, 2, cv2.LINE_AA)


def _draw_frame_footer(frame: np.ndarray, overlay_mode: str, test_mode: bool) -> None:
    footer = f"Mode: {overlay_mode.replace('_', ' ').title()}"
    if test_mode:
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
