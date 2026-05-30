from __future__ import annotations

import subprocess
import threading
import uuid
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
MAKE_BANNER_SECONDS = 1.0
ATTEMPT_CONFIRMATION_FRAMES = 2
ATTEMPT_RESULT_WINDOW_SECONDS = 3.2
RECENT_SHOT_SIGNAL_SECONDS = 0.9
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


def _apply_orientation_correction(
    frame: np.ndarray,
    orientation_degrees: int,
    *,
    auto_orientation_enabled: bool,
    encoded_frame_size: tuple[int, int],
) -> np.ndarray:
    normalized_orientation = orientation_degrees % 360
    if normalized_orientation == 0:
        return frame

    frame_height, frame_width = frame.shape[:2]
    encoded_width, encoded_height = encoded_frame_size

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

    if not needs_manual_rotation:
        return frame

    rotation_map = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }
    rotate_code = rotation_map.get(normalized_orientation)
    if rotate_code is None:
        return frame
    return cv2.rotate(frame, rotate_code)


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
        self.banner_text = "Ready to analyze."
        self.banner_until_frame = -1
        self.pending_shot_streak = 0
        self.active_attempt_frame: Optional[int] = None
        self.awaiting_shot_reset = False
        self.direct_make_detection_active = False
        self.shot_cooldown_frames = max(1, int(self.fps * SHOT_COOLDOWN_SECONDS))
        self.make_cooldown_frames = max(1, int(self.fps * MAKE_COOLDOWN_SECONDS))
        self.banner_duration_frames = max(10, int(self.fps * MAKE_BANNER_SECONDS))
        self.attempt_confirmation_frames = max(1, ATTEMPT_CONFIRMATION_FRAMES)
        self.attempt_result_window_frames = max(10, int(self.fps * ATTEMPT_RESULT_WINDOW_SECONDS))
        self.recent_shot_signal_frames = max(3, int(self.fps * RECENT_SHOT_SIGNAL_SECONDS))

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

    def observe(self, detections: list[Dict[str, float | str]], frame_index: int) -> None:
        basket_detection = _best_detection(detections, "basket")
        if basket_detection:
            self.last_basket_center = _detection_center(basket_detection)
            self.last_basket_radius = _basket_make_radius(basket_detection)

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

        if (
            self.active_attempt_frame is None
            and self.pending_shot_streak >= self.attempt_confirmation_frames
            and frame_index - self.last_attempt_frame >= self.shot_cooldown_frames
        ):
            self._start_attempt(frame_index, "Shot attempt detected")
            self.pending_shot_streak = 0

        direct_make_detection = _best_detection(detections, "ball_in_basket")
        direct_make_started = direct_make_detection is not None and not self.direct_make_detection_active
        make_detection = direct_make_detection or _infer_make_detection(
            detections,
            basket_detection=basket_detection,
            last_basket_center=self.last_basket_center,
            last_basket_radius=self.last_basket_radius,
        )
        if make_detection and frame_index - self.last_make_frame >= self.make_cooldown_frames:
            if self.active_attempt_frame is None and self._recent_shot_signal(frame_index):
                self._start_attempt(frame_index, "Shot attempt inferred")
            elif self.active_attempt_frame is None and direct_make_started:
                self._start_attempt(frame_index, "Made basket detected")
            if self.active_attempt_frame is not None:
                self.makes += 1
                self.last_make_frame = frame_index
                self._resolve_attempt(frame_index, made=True, banner_text="Made basket detected")
                if self.last_basket_center is None:
                    self.last_basket_center = _detection_center(make_detection)
        self.direct_make_detection_active = direct_make_detection is not None

        if (
            self.active_attempt_frame is not None
            and frame_index - self.active_attempt_frame >= self.attempt_result_window_frames
        ):
            self._resolve_attempt(frame_index, made=False, banner_text="Miss recorded")

    def _set_banner(self, text: str, frame_index: int) -> None:
        self.banner_text = text
        self.banner_until_frame = frame_index + self.banner_duration_frames

    def banner_is_active(self, frame_index: int) -> bool:
        return frame_index <= self.banner_until_frame

    def _recent_shot_signal(self, frame_index: int) -> bool:
        return frame_index - self.last_shot_signal_frame <= self.recent_shot_signal_frames

    def _start_attempt(self, frame_index: int, banner_text: str) -> None:
        self.attempts += 1
        self.last_attempt_frame = frame_index
        self.active_attempt_frame = frame_index
        self.awaiting_shot_reset = True
        self._set_banner(banner_text, frame_index)

    def _resolve_attempt(self, frame_index: int, made: bool, banner_text: str) -> None:
        if self.active_attempt_frame is None:
            return
        if not made:
            self._misses += 1
        self.active_attempt_frame = None
        self.pending_shot_streak = 0
        self._set_banner(banner_text, frame_index)


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
    ) -> None:
        self.file_id = file_id
        self.detector = detector
        self.input_path = input_path
        self.output_path = output_path
        self.overlay_mode = overlay_mode
        self.test_mode = test_mode
        self.user_key = user_key

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
            )
            frame_height, frame_width = first_frame.shape[:2]

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
                stats=tracker.to_stats(),
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
                        stats=tracker.to_stats(),
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
                stats=tracker.to_stats(),
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
        _draw_frame_footer(frame, self.overlay_mode, self.test_mode)


def start_shot_training_job(
    detector: BallDetector,
    video: UploadFile,
    overlay_mode: str,
    test_mode: bool,
    user_key: str,
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
            "processed_frames": 0,
            "total_frames": 0,
            "progress_percentage": 0,
            "stats": {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
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
                "processed_frames": 0,
                "total_frames": 0,
                "progress_percentage": 0,
                "stats": {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
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

    if basket_detection is not None and _ball_overlaps_basket(ball_detection, basket_detection):
        inferred = ball_detection.copy()
        inferred["label"] = "ball_in_basket"
        inferred["display_label"] = "Ball In Basket"
        return inferred

    if last_basket_center is not None and last_basket_radius > 0:
        ball_center = _detection_center(ball_detection)
        if _point_distance(ball_center, last_basket_center) <= last_basket_radius:
            inferred = ball_detection.copy()
            inferred["label"] = "ball_in_basket"
            inferred["display_label"] = "Ball In Basket"
            return inferred

    return None


def _ball_overlaps_basket(ball_detection: Dict[str, float | str], basket_detection: Dict[str, float | str]) -> bool:
    basket_x1 = float(basket_detection["x1"])
    basket_y1 = float(basket_detection["y1"])
    basket_x2 = float(basket_detection["x2"])
    basket_y2 = float(basket_detection["y2"])
    basket_width = max(1.0, basket_x2 - basket_x1)
    basket_height = max(1.0, basket_y2 - basket_y1)

    expanded_basket = {
        "x1": basket_x1 - basket_width * 0.35,
        "y1": basket_y1 - basket_height * 0.45,
        "x2": basket_x2 + basket_width * 0.35,
        "y2": basket_y2 + basket_height * 0.75,
    }
    ball_center = _detection_center(ball_detection)
    return (
        expanded_basket["x1"] <= ball_center[0] <= expanded_basket["x2"]
        and expanded_basket["y1"] <= ball_center[1] <= expanded_basket["y2"]
    )


def _basket_make_radius(basket_detection: Dict[str, float | str]) -> float:
    width = abs(float(basket_detection["x2"]) - float(basket_detection["x1"]))
    height = abs(float(basket_detection["y2"]) - float(basket_detection["y1"]))
    return max(18.0, max(width, height) * 0.8)


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
    panel_width = min(width - 32, 360)
    panel_height = 110
    x = 16
    y = max(16, height - panel_height - 16)
    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + panel_width, y + panel_height), (18, 22, 34), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (x, y), (x + panel_width, y + panel_height), (20, 105, 255), 2)

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
) -> None:
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (165, 175, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, value, (x, y + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.88, color, 2, cv2.LINE_AA)


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
