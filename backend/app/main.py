from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .ball_detector import BallDetector
from .feedback_engine import extract_features, generate_feedback
from .pose_estimator import PoseEstimator
from .scoring import calculate_score, classify_score
from .schemas import (
    FeedbackCue,
    FrameAnalysisResponse,
    ModeInfo,
    SessionRecord,
    ShotTrainingStartResponse,
    ShotTrainingStatusResponse,
    VideoAnalysisResponse,
)
from .shot_training import (
    ensure_shot_training_dirs,
    get_shot_training_output_path,
    get_shot_training_status,
    start_shot_training_job,
)
from .utils import (
    append_session_history,
    decode_image_bytes,
    delete_session_history_record,
    draw_text_block,
    ensure_data_dir,
    frame_to_base64,
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
pose_estimator = PoseEstimator()
ball_detector = BallDetector()

MODE_LIBRARY = [
    ModeInfo(
        id="shooting_form",
        title="Shooting Form",
        description="Analyze shot mechanics, release structure, and ball control.",
        target_focus=["elbow alignment", "knee bend", "ball release", "balance"],
    ),
    ModeInfo(
        id="defensive_stance",
        title="Defensive Stance",
        description="Evaluate low stance readiness and defensive body position.",
        target_focus=["stance width", "knee bend", "torso readiness", "symmetry"],
    ),
    ModeInfo(
        id="basic_footwork",
        title="Basic Footwork",
        description="Assess posture and base stability during movement drills.",
        target_focus=["feet spacing", "torso control", "athletic base", "balance"],
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
def get_sessions() -> List[SessionRecord]:
    records = load_session_history()
    return [SessionRecord(**record) for record in reversed(records)]


@app.delete("/sessions/{session_id}", response_model=dict)
def delete_session(session_id: str) -> dict:
    deleted = delete_session_history_record(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session record not found.")
    return {"status": "deleted", "session_id": session_id}


@app.post("/shooting-training/start", response_model=ShotTrainingStartResponse)
async def start_shooting_training(
    video: UploadFile = File(...),
    overlay_mode: str = Form("focus_stats"),
    test_mode: bool = Form(False),
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

    job = start_shot_training_job(
        detector=ball_detector,
        video=video,
        overlay_mode=overlay_mode,
        test_mode=test_mode,
    )
    return ShotTrainingStartResponse(
        file_id=str(job["file_id"]),
        status=str(job["status"]),
        overlay_mode=str(job["overlay_mode"]),
        test_mode=bool(job["test_mode"]),
    )


@app.get("/shooting-training/status/{file_id}", response_model=ShotTrainingStatusResponse)
def get_shooting_training_status(file_id: str) -> ShotTrainingStatusResponse:
    job = get_shot_training_status(file_id)
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
    frame: UploadFile = File(...),
) -> FrameAnalysisResponse:
    if mode not in {item.id for item in MODE_LIBRARY}:
        raise HTTPException(status_code=400, detail="Invalid coaching mode.")

    image_bytes = await frame.read()
    try:
        np_frame = decode_image_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unable to decode uploaded frame.") from exc

    result = _analyze_single_frame(np_frame, mode=mode, session_id=new_session_id(), frame_index=0)
    _save_session_record(
        session_id=result.session_id,
        mode=result.mode,
        score=result.score.score,
        classification=result.score.classification,
        summary=result.coaching_summary,
        source_type="frame",
    )
    return result


@app.post("/analyze-video", response_model=VideoAnalysisResponse)
@app.post("/analyze/video", response_model=VideoAnalysisResponse, include_in_schema=False)
async def analyze_video(
    mode: str = Form(...),
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
    sampled_results: List[FrameAnalysisResponse] = []

    try:
        while True:
            success, frame = capture.read()
            if not success:
                break
            processed_frames += 1
            if frame_index % max(sample_stride, 1) == 0:
                sampled_results.append(
                    _analyze_single_frame(frame, mode=mode, session_id=session_id, frame_index=frame_index)
                )
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
    for item in sampled_results:
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

    classification = classify_score(average_score)
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
    )
    return response


def _analyze_single_frame(frame, mode: str, session_id: str, frame_index: int) -> FrameAnalysisResponse:
    pose_result = pose_estimator.detect(frame)
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

    annotated = pose_estimator.draw(frame, pose_result["raw_landmarks"])
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

    return FrameAnalysisResponse(
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
        annotated_frame_base64=frame_to_base64(annotated),
    )


def _save_session_record(
    session_id: str,
    mode: str,
    score: float,
    classification: str,
    summary: str,
    source_type: str,
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
        }
    )
