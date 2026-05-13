from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


CoachingMode = Literal["shooting_form", "defensive_stance", "basic_footwork"]


class Point2D(BaseModel):
    x: float
    y: float
    visibility: float = 1.0


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    label: str = "basketball"


class FeatureSet(BaseModel):
    shoulder_angle: Optional[float] = None
    elbow_angle: Optional[float] = None
    wrist_alignment: Optional[float] = None
    knee_bend_angle: Optional[float] = None
    torso_alignment: Optional[float] = None
    feet_spacing: Optional[float] = None
    ball_to_wrist_distance: Optional[float] = None
    ball_release_position: Optional[float] = None
    body_balance: Optional[float] = None
    symmetry_score: Optional[float] = None


class FeedbackCue(BaseModel):
    code: str
    message: str
    severity: Literal["low", "medium", "high"] = "medium"
    deduction: int = 0


class ScoreResult(BaseModel):
    score: int
    classification: Literal["Excellent", "Good", "Needs Improvement", "Poor"]
    deductions: int


class FrameAnalysisResponse(BaseModel):
    session_id: str
    mode: CoachingMode
    timestamp: datetime
    frame_index: int = 0
    pose_detected: bool
    ball_detected: bool
    features: FeatureSet
    feedback: List[FeedbackCue]
    score: ScoreResult
    coaching_summary: str
    ball_box: Optional[BoundingBox] = None
    landmarks: Dict[str, Point2D] = Field(default_factory=dict)
    annotated_frame_base64: Optional[str] = None


class VideoAnalysisResponse(BaseModel):
    session_id: str
    mode: CoachingMode
    timestamp: datetime
    processed_frames: int
    sampled_frames: int
    average_score: float
    best_score: int
    worst_score: int
    classification: Literal["Excellent", "Good", "Needs Improvement", "Poor"]
    dominant_feedback: List[str]
    frame_results: List[FrameAnalysisResponse]
    session_summary: str


class SessionRecord(BaseModel):
    session_id: str
    mode: CoachingMode
    timestamp: datetime
    score: float
    classification: str
    summary: str
    source_type: Literal["frame", "video"]


class ModeInfo(BaseModel):
    id: CoachingMode
    title: str
    description: str
    target_focus: List[str]


class ErrorResponse(BaseModel):
    detail: str
