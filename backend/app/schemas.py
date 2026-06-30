from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


CoachingMode = Literal[
    "unified_coaching",
    "shooting_form",
    "dribbling",
    "passing",
    "defensive_stance",
    "basic_footwork",
    "shot_training",
]
ShotTrainingOverlayMode = Literal["full_tracking", "focus_stats", "stats_only"]
ShotTrainingStatus = Literal["queued", "processing", "completed", "error", "cancelled", "not_found"]
CoachingVideoOverlayMode = Literal["full_overlay", "focus_feedback", "score_only"]
CoachingVideoStatus = Literal["queued", "processing", "completed", "error", "cancelled", "not_found"]
SourceOrientation = Literal["auto", "portrait", "landscape"]


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
    ball_body_offset: Optional[float] = None
    ball_vertical_zone: Optional[str] = None
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


class PhaseScore(BaseModel):
    key: str
    label: str
    average_score: float = 0.0
    frame_count: int = 0
    status: Literal["excellent", "good", "developing", "needs_focus", "not_observed"] = "not_observed"
    focus: str
    cue: str


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
    phase_scores: List[PhaseScore] = Field(default_factory=list)
    frame_results: List[FrameAnalysisResponse]
    session_summary: str


class SessionRecord(BaseModel):
    session_id: str
    mode: CoachingMode
    timestamp: datetime
    score: float
    classification: str
    summary: str
    source_type: Literal["frame", "video", "shot_training_video"]
    action_count: int = 0
    action_label: Optional[str] = None
    shooting_stats: Dict[str, object] = Field(default_factory=dict)
    shot_events: List[Dict[str, object]] = Field(default_factory=list)
    phase_scores: List[Dict[str, object]] = Field(default_factory=list)
    user_key: Optional[str] = None


class ModeInfo(BaseModel):
    id: CoachingMode
    title: str
    description: str
    target_focus: List[str]


class ErrorResponse(BaseModel):
    detail: str


class ShotTrainingStats(BaseModel):
    attempts: int = 0
    makes: int = 0
    misses: int = 0
    accuracy: float = 0.0


class ShotEvent(BaseModel):
    shot_number: int
    result: str = "pending"
    timestamp_seconds: float = 0.0
    start_frame: int = 0
    result_timestamp_seconds: Optional[float] = None
    result_frame: Optional[int] = None
    result_quality: Optional[str] = None
    result_reason: Optional[str] = None
    evidence: List[str] = Field(default_factory=list)


class ShotTrainingStartResponse(BaseModel):
    file_id: str
    status: ShotTrainingStatus
    overlay_mode: ShotTrainingOverlayMode
    test_mode: bool = False
    source_orientation: SourceOrientation = "auto"


class ShotTrainingStatusResponse(BaseModel):
    file_id: str
    status: ShotTrainingStatus
    overlay_mode: Optional[ShotTrainingOverlayMode] = None
    test_mode: bool = False
    source_orientation: Optional[SourceOrientation] = None
    processed_frames: int = 0
    total_frames: int = 0
    progress_percentage: int = 0
    input_width: int = 0
    input_height: int = 0
    output_width: int = 0
    output_height: int = 0
    input_orientation: str = "unknown"
    output_orientation: str = "unknown"
    stats: ShotTrainingStats = Field(default_factory=ShotTrainingStats)
    shot_events: List[ShotEvent] = Field(default_factory=list)
    classification: Optional[str] = None
    summary: Optional[str] = None
    error_message: Optional[str] = None


class CoachingVideoStartResponse(BaseModel):
    file_id: str
    mode: CoachingMode
    status: CoachingVideoStatus
    overlay_mode: CoachingVideoOverlayMode
    test_mode: bool = False
    source_orientation: SourceOrientation = "auto"


class PoseComparisonMetric(BaseModel):
    key: str
    label: str
    actual_value: Optional[float] = None
    actual_display: str
    reference_display: str
    match_rate: float = 0.0
    observed_frames: int = 0
    status: Literal["matched", "close", "needs_focus", "insufficient"] = "insufficient"
    coaching_cue: str


class CoachingVideoStatusResponse(BaseModel):
    file_id: str
    mode: Optional[CoachingMode] = None
    status: CoachingVideoStatus
    overlay_mode: Optional[CoachingVideoOverlayMode] = None
    test_mode: bool = False
    source_orientation: Optional[SourceOrientation] = None
    processed_frames: int = 0
    total_frames: int = 0
    progress_percentage: int = 0
    input_width: int = 0
    input_height: int = 0
    output_width: int = 0
    output_height: int = 0
    input_orientation: str = "unknown"
    output_orientation: str = "unknown"
    analyzed_frames: int = 0
    pose_frames: int = 0
    ball_frames: int = 0
    pose_detection_rate: float = 0.0
    ball_detection_rate: float = 0.0
    average_score: float = 0.0
    best_score: int = 0
    worst_score: int = 0
    action_count: int = 0
    action_label: Optional[str] = None
    shooting_stats: ShotTrainingStats = Field(default_factory=ShotTrainingStats)
    shot_events: List[ShotEvent] = Field(default_factory=list)
    dominant_feedback: List[str] = Field(default_factory=list)
    pose_comparison: List[PoseComparisonMetric] = Field(default_factory=list)
    phase_scores: List[PhaseScore] = Field(default_factory=list)
    classification: Optional[str] = None
    summary: Optional[str] = None
    error_message: Optional[str] = None
