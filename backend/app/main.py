from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .ball_detector import BallDetector
from .clip_validity import apply_coaching_clip_validity, merge_validity_warnings
from .coaching_analysis import run_coaching_analysis
from .coaching_video import (
    CoachingActionCounter,
    cancel_coaching_video_job,
    effective_coaching_sample_stride,
    ensure_coaching_video_dirs,
    get_coaching_video_output_path,
    get_coaching_video_status,
    start_coaching_video_job,
)
from .feedback_engine import extract_features, generate_feedback
from .one_euro import LandmarkSmoother
from .pose_estimator import PoseEstimator
from .schemas import (
    CoachingVideoStartResponse,
    CoachingVideoStatusResponse,
    FeedbackCue,
    FrameAnalysisResponse,
    ModeInfo,
    SessionRecord,
    ShotTrainingStartResponse,
    ShotTrainingStatusResponse,
    VideoAnalysisResponse,
)
from .shot_training import (
    cancel_shot_training_job,
    ensure_shot_training_dirs,
    get_shot_training_output_path,
    get_shot_training_status,
    start_shot_training_job,
)
from .utils import (
    append_session_history,
    decode_image_bytes,
    delete_session_history_record,
    ensure_data_dir,
    load_session_history,
    new_session_id,
    now_utc,
)


app = FastAPI(
    title="SureBall Prototype API",
    version="0.1.0",
    description="Rule-based basketball coaching backend using MediaPipe Pose and YOLOv11.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_data_dir()
ensure_shot_training_dirs()
ensure_coaching_video_dirs()

SOURCE_ORIENTATION_VALUES = {"auto", "portrait", "landscape"}


def validate_source_orientation(value: str) -> str:
    normalized = str(value or "auto").strip().lower()
    if normalized not in SOURCE_ORIENTATION_VALUES:
        raise HTTPException(status_code=400, detail="Invalid source orientation.")
    return normalized
pose_estimator = PoseEstimator()
ball_detector = BallDetector()

MODE_LIBRARY = [
    ModeInfo(
        id="shooting_form",
        title="Shooting",
        description="Analyze shot mechanics, release structure, and ball control.",
        target_focus=["elbow alignment", "knee bend", "ball release", "balance"],
    ),
    ModeInfo(
        id="dribbling",
        title="Dribbling",
        description="Analyze ball control, low handle position, body balance, and athletic stance.",
        target_focus=["ball control", "low handle", "knee bend", "balance"],
    ),
    ModeInfo(
        id="passing",
        title="Passing",
        description="Evaluate pass setup, hand-to-ball connection, release line, and balance.",
        target_focus=["ball control", "release line", "torso control", "balance"],
    ),
]


@app.get("/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "service": "sureball-backend",
        "pose_estimator": "ready",
        "ball_detector_ready": ball_detector.ready,
        "ball_detector_model": ball_detector.model_source,
        "shot_training_ready": ball_detector.supports_shot_training(),
    }


@app.get("/modes", response_model=List[ModeInfo])
def get_modes() -> List[ModeInfo]:
    return MODE_LIBRARY


@app.get("/sessions", response_model=List[SessionRecord])
def get_sessions(user_key: str) -> List[SessionRecord]:
    records = load_session_history(user_key=user_key)
    return [SessionRecord(**record) for record in reversed(records)]


@app.delete("/sessions/{session_id}", response_model=dict)
def delete_session(session_id: str, user_key: str) -> dict:
    deleted = delete_session_history_record(session_id, user_key=user_key)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session record not found.")
    return {"status": "deleted", "session_id": session_id}


@app.post("/shooting-training/start", response_model=ShotTrainingStartResponse)
async def start_shooting_training(
    video: UploadFile = File(...),
    overlay_mode: str = Form("focus_stats"),
    test_mode: bool = Form(False),
    user_key: str = Form(...),
    source_orientation: str = Form("auto"),
) -> ShotTrainingStartResponse:
    if not ball_detector.ready:
        raise HTTPException(status_code=503, detail="Ball detector model is not ready.")
    if not ball_detector.supports_shot_training():
        raise HTTPException(
            status_code=503,
            detail="Shot training requires the custom 5-class SureBall detector weights.",
        )
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(status_code=400, detail="Please upload a video file.")
    if overlay_mode not in {"full_tracking", "focus_stats", "stats_only"}:
        raise HTTPException(status_code=400, detail="Invalid shot training overlay mode.")
    source_orientation = validate_source_orientation(source_orientation)

    job = start_shot_training_job(
        detector=ball_detector,
        video=video,
        overlay_mode=overlay_mode,
        test_mode=test_mode,
        user_key=user_key,
        source_orientation=source_orientation,
    )
    return ShotTrainingStartResponse(
        file_id=str(job["file_id"]),
        status=str(job["status"]),
        overlay_mode=str(job["overlay_mode"]),
        test_mode=bool(job["test_mode"]),
        source_orientation=str(job["source_orientation"]),
    )


@app.post("/coaching-video/start", response_model=CoachingVideoStartResponse)
async def start_coaching_video(
    mode: str = Form(...),
    video: UploadFile = File(...),
    overlay_mode: str = Form("focus_feedback"),
    test_mode: bool = Form(False),
    user_key: str = Form(...),
    source_orientation: str = Form("auto"),
) -> CoachingVideoStartResponse:
    if mode not in {item.id for item in MODE_LIBRARY}:
        raise HTTPException(status_code=400, detail="Invalid coaching mode.")
    if not ball_detector.ready:
        raise HTTPException(status_code=503, detail="Ball detector model is not ready.")
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(status_code=400, detail="Please upload a video file.")
    if overlay_mode not in {"full_overlay", "focus_feedback", "score_only"}:
        raise HTTPException(status_code=400, detail="Invalid coaching video overlay mode.")
    source_orientation = validate_source_orientation(source_orientation)

    job = start_coaching_video_job(
        mode=mode,
        pose_estimator=pose_estimator,
        ball_detector=ball_detector,
        video=video,
        overlay_mode=overlay_mode,
        test_mode=test_mode,
        user_key=user_key,
        source_orientation=source_orientation,
    )
    return CoachingVideoStartResponse(
        file_id=str(job["file_id"]),
        mode=str(job["mode"]),
        status=str(job["status"]),
        overlay_mode=str(job["overlay_mode"]),
        test_mode=bool(job["test_mode"]),
        source_orientation=str(job["source_orientation"]),
    )


@app.get("/coaching-video/status/{file_id}", response_model=CoachingVideoStatusResponse)
def get_coaching_video_job_status(file_id: str) -> CoachingVideoStatusResponse:
    job = get_coaching_video_status(file_id)
    return CoachingVideoStatusResponse(**job)


@app.post("/coaching-video/cancel/{file_id}", response_model=CoachingVideoStatusResponse)
def cancel_coaching_video_job_status(file_id: str) -> CoachingVideoStatusResponse:
    job = cancel_coaching_video_job(file_id)
    return CoachingVideoStatusResponse(**job)


@app.get("/coaching-video/download/{file_id}")
def download_coaching_video_result(file_id: str) -> FileResponse:
    output_path = get_coaching_video_output_path(file_id)
    if output_path is None:
        raise HTTPException(status_code=404, detail="Annotated coaching result video is not ready yet.")
    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=f"sureball-coaching-{file_id}.mp4",
    )


@app.get("/shooting-training/status/{file_id}", response_model=ShotTrainingStatusResponse)
def get_shooting_training_status(file_id: str) -> ShotTrainingStatusResponse:
    job = get_shot_training_status(file_id)
    return ShotTrainingStatusResponse(**job)


@app.post("/shooting-training/cancel/{file_id}", response_model=ShotTrainingStatusResponse)
def cancel_shooting_training_status(file_id: str) -> ShotTrainingStatusResponse:
    job = cancel_shot_training_job(file_id)
    return ShotTrainingStatusResponse(**job)


@app.get("/shooting-training/download/{file_id}")
def download_shooting_training_result(file_id: str) -> FileResponse:
    output_path = get_shot_training_output_path(file_id)
    if output_path is None:
        raise HTTPException(status_code=404, detail="Annotated result video is not ready yet.")
    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=f"sureball-shot-training-{file_id}.mp4",
    )


@app.post("/analyze-frame", response_model=FrameAnalysisResponse)
@app.post("/analyze/frame", response_model=FrameAnalysisResponse, include_in_schema=False)
async def analyze_frame(
    mode: str = Form(...),
    user_key: str = Form(...),
    frame: UploadFile = File(...),
) -> FrameAnalysisResponse:
    if mode not in {item.id for item in MODE_LIBRARY}:
        raise HTTPException(status_code=400, detail="Invalid coaching mode.")

    image_bytes = await frame.read()
    try:
        np_frame = decode_image_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unable to decode uploaded frame.") from exc

    result = run_coaching_analysis(
        np_frame,
        mode=mode,
        session_id=new_session_id(),
        frame_index=0,
        pose_estimator=pose_estimator,
        ball_detector=ball_detector,
    )["response"]
    _save_session_record(
        session_id=result.session_id,
        mode=result.mode,
        score=result.score.score,
        classification=result.score.classification,
        summary=result.coaching_summary,
        source_type="frame",
        user_key=user_key,
    )
    return result


@app.post("/analyze-video", response_model=VideoAnalysisResponse)
@app.post("/analyze/video", response_model=VideoAnalysisResponse, include_in_schema=False)
async def analyze_video(
    mode: str = Form(...),
    user_key: str = Form(...),
    video: UploadFile = File(...),
    sample_stride: int = Form(5),
) -> VideoAnalysisResponse:
    if mode not in {item.id for item in MODE_LIBRARY}:
        raise HTTPException(status_code=400, detail="Invalid coaching mode.")

    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        tmp_file.write(await video.read())
        temp_path = Path(tmp_file.name)

    capture = cv2.VideoCapture(str(temp_path))
    if not capture.isOpened():
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Unable to open uploaded video.")

    session_id = new_session_id()
    frame_index = 0
    processed_frames = 0
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    sampled_results: List[FrameAnalysisResponse] = []
    action_counter = CoachingActionCounter(mode, fps=fps)
    landmark_smoother = LandmarkSmoother(min_cutoff=1.2, beta=0.03, derivative_cutoff=1.0)

    try:
        while True:
            success, frame = capture.read()
            if not success:
                break
            processed_frames += 1
            if frame_index % effective_coaching_sample_stride(mode, sample_stride) == 0:
                result = run_coaching_analysis(
                    frame,
                    mode=mode,
                    session_id=session_id,
                    frame_index=frame_index,
                    pose_estimator=pose_estimator,
                    ball_detector=ball_detector,
                    landmark_smoother=landmark_smoother,
                    timestamp_seconds=frame_index / max(fps, 1.0),
                )["response"]
                action_counter.observe(result)
                sampled_results.append(result)
            frame_index += 1
    finally:
        capture.release()
        temp_path.unlink(missing_ok=True)

    if not sampled_results:
        raise HTTPException(status_code=400, detail="No analyzable frames found in the uploaded video.")

    average_score = sum(item.score.score for item in sampled_results) / len(sampled_results)
    best_score = max(item.score.score for item in sampled_results)
    worst_score = min(item.score.score for item in sampled_results)
    cue_frequency: dict[str, int] = {}
    pose_frames = 0
    ball_frames = 0
    shooting_evidence_frames = 0
    for item in sampled_results:
        if item.pose_detected:
            pose_frames += 1
        if item.ball_detected:
            ball_frames += 1
        if mode == "shooting_form" and _has_shooting_evidence(item):
            shooting_evidence_frames += 1
        for cue in item.feedback:
            if cue.code == "solid_form":
                continue
            cue_frequency[cue.message] = cue_frequency.get(cue.message, 0) + 1
    dominant_feedback = [
        message
        for message, _count in sorted(cue_frequency.items(), key=lambda entry: entry[1], reverse=True)[:3]
    ]
    if not dominant_feedback:
        dominant_feedback = ["Strong overall movement quality detected."]

    validity = apply_coaching_clip_validity(
        mode=mode,
        average_score=average_score,
        best_score=best_score,
        worst_score=worst_score,
        analyzed_frames=len(sampled_results),
        pose_frames=pose_frames,
        ball_frames=ball_frames,
        action_label=action_counter.action_label,
        action_count=action_counter.count,
        shooting_evidence_frames=shooting_evidence_frames,
    )
    average_score = validity.average_score
    best_score = validity.best_score
    worst_score = validity.worst_score
    dominant_feedback = merge_validity_warnings(validity.warnings, dominant_feedback)
    classification = validity.classification
    session_summary = (
        f"{mode.replace('_', ' ').title()} session completed with an average score of "
        f"{average_score:.1f}. Focus areas: {', '.join(dominant_feedback)}"
    )

    response = VideoAnalysisResponse(
        session_id=session_id,
        mode=mode,
        timestamp=now_utc(),
        processed_frames=processed_frames,
        sampled_frames=len(sampled_results),
        average_score=round(average_score, 2),
        best_score=best_score,
        worst_score=worst_score,
        classification=classification,
        dominant_feedback=dominant_feedback,
        frame_results=sampled_results[:10],
        session_summary=session_summary,
    )

    _save_session_record(
        session_id=response.session_id,
        mode=response.mode,
        score=response.average_score,
        classification=response.classification,
        summary=response.session_summary,
        source_type="video",
        user_key=user_key,
    )
    return response


def _has_shooting_evidence(result: FrameAnalysisResponse) -> bool:
    return result.pose_detected and result.ball_detected


def _save_session_record(
    session_id: str,
    mode: str,
    score: float,
    classification: str,
    summary: str,
    source_type: str,
    user_key: str,
) -> None:
    append_session_history(
        {
            "session_id": session_id,
            "mode": mode,
            "timestamp": now_utc().isoformat(),
            "score": score,
            "classification": classification,
            "summary": summary,
            "source_type": source_type,
            "user_key": user_key,
        }
    )
