from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable, Literal, Mapping, Optional

try:
    from .schemas import ScoreResult
except ImportError:  # pragma: no cover
    ScoreResult = None  # type: ignore[assignment]


ModeName = Literal[
    "unified_coaching",
    "shooting_form",
    "dribbling",
    "passing",
    "defensive_stance",
    "basic_footwork",
    "footwork",
]
SeverityLevel = Literal["Minor", "Moderate", "Major"]
Classification = Literal["Excellent", "Good", "Needs Improvement", "Poor"]

EXCELLENT_SCORE_MIN = 85
GOOD_SCORE_MIN = 72
NEEDS_IMPROVEMENT_SCORE_MIN = 58
DEDUCTION_SCALE = 0.7


@dataclass
class DetectedError:
    code: str
    issue: str
    severity: SeverityLevel
    deduction: int
    metric: Optional[str] = None
    value: Optional[float] = None
    recommendation: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ScoringResult:
    mode: str
    final_score: int
    total_deductions: int
    detected_errors: list[DetectedError]
    classification: Classification

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["detected_errors"] = [item.to_dict() for item in self.detected_errors]
        return payload


def classify_score(score: float) -> Classification:
    if score >= EXCELLENT_SCORE_MIN:
        return "Excellent"
    if score >= GOOD_SCORE_MIN:
        return "Good"
    if score >= NEEDS_IMPROVEMENT_SCORE_MIN:
        return "Needs Improvement"
    return "Poor"


def score_movement(
    mode: ModeName,
    features: Any,
    extra_metrics: Optional[Mapping[str, float]] = None,
    start_score: int = 100,
) -> ScoringResult:
    normalized_mode = _normalize_mode(mode)
    metrics = _merge_metrics(features, extra_metrics)

    if normalized_mode == "shooting_form":
        detected_errors = _score_shooting_form(metrics)
    elif normalized_mode == "dribbling":
        detected_errors = _score_dribbling(metrics)
    elif normalized_mode == "passing":
        detected_errors = _score_passing(metrics)
    elif normalized_mode == "defensive_stance":
        detected_errors = _score_defensive_stance(metrics)
    else:
        detected_errors = _score_footwork(metrics)

    total_deductions = sum(_scale_deduction(item.deduction) for item in detected_errors)
    final_score = max(0, start_score - total_deductions)

    return ScoringResult(
        mode=normalized_mode,
        final_score=final_score,
        total_deductions=total_deductions,
        detected_errors=detected_errors,
        classification=classify_score(final_score),
    )


def calculate_score(
    feedback_items: Optional[Iterable[Any]] = None,
    start_score: int = 100,
    *,
    mode: Optional[ModeName] = None,
    features: Any = None,
    extra_metrics: Optional[Mapping[str, float]] = None,
) -> Any:
    """
    Backward-compatible scoring entry point.

    Usage:
    - `calculate_score(feedback_items=[...])` for existing feedback-based scoring
    - `calculate_score(mode="shooting_form", features=feature_set)` for rule-based mode scoring
    """

    if mode is not None and features is not None:
        result = score_movement(
            mode=mode,
            features=features,
            extra_metrics=extra_metrics,
            start_score=start_score,
        )
        if ScoreResult is not None:
            return ScoreResult(
                score=result.final_score,
                deductions=result.total_deductions,
                classification=result.classification,
            )
        return result

    if feedback_items is None:
        raise ValueError("Either feedback_items or both mode and features must be provided.")

    deductions = sum(_extract_feedback_deduction(item) for item in feedback_items)
    score = max(0, start_score - deductions)
    classification = classify_score(score)

    if ScoreResult is not None:
        return ScoreResult(score=score, deductions=deductions, classification=classification)

    return {
        "score": score,
        "deductions": deductions,
        "classification": classification,
    }


def build_score_response(
    mode: ModeName,
    features: Any,
    extra_metrics: Optional[Mapping[str, float]] = None,
    start_score: int = 100,
) -> dict[str, Any]:
    return score_movement(
        mode=mode,
        features=features,
        extra_metrics=extra_metrics,
        start_score=start_score,
    ).to_dict()


def _score_shooting_form(metrics: Mapping[str, float]) -> list[DetectedError]:
    issues: list[DetectedError] = []

    issues.extend(
        _banded_error(
            value=_metric(metrics, "elbow_angle"),
            code="poor_elbow_angle",
            issue="Poor elbow angle",
            metric="elbow_angle",
            recommendation="Keep the shooting elbow around a compact 85 to 105 degree bend.",
            bands=[
                (78.0, 112.0, "Minor", 5),
                (70.0, 120.0, "Moderate", 10),
            ],
            major=("Major", 15),
            inverted_range=True,
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "wrist_alignment"),
            thresholds=[(0.16, "Minor", 4), (0.24, "Moderate", 8), (0.32, "Major", 12)],
            code="wrist_not_aligned",
            issue="Wrist not aligned with elbow",
            metric="wrist_alignment",
            recommendation="Stack the wrist over the elbow on the shooting line.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "knee_bend_angle"),
            thresholds=[(155.0, "Minor", 3), (168.0, "Moderate", 6), (176.0, "Major", 9)],
            code="insufficient_knee_bend",
            issue="Limited knee load",
            metric="knee_bend_angle",
            recommendation="Use a comfortable knee bend before release without forcing a deep squat.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "body_balance"),
            thresholds=[(0.10, "Minor", 4), (0.18, "Moderate", 8), (0.25, "Major", 12)],
            code="shoulder_imbalance",
            issue="Shoulder imbalance",
            metric="body_balance",
            recommendation="Keep both shoulders level through the shot.",
        )
    )

    return issues


def _score_defensive_stance(metrics: Mapping[str, float]) -> list[DetectedError]:
    issues: list[DetectedError] = []

    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "knee_bend_angle"),
            thresholds=[(135.0, "Minor", 5), (145.0, "Moderate", 9), (155.0, "Major", 13)],
            code="knees_not_bent_enough",
            issue="Knees not bent enough",
            metric="knee_bend_angle",
            recommendation="Sit lower to stay explosive on defense.",
        )
    )
    issues.extend(
        _less_than_error(
            value=_metric(metrics, "feet_spacing"),
            thresholds=[(1.10, "Minor", 4), (0.95, "Moderate", 8), (0.80, "Major", 12)],
            code="feet_too_close",
            issue="Feet too close together",
            metric="feet_spacing",
            recommendation="Widen the base to about shoulder width or a bit wider.",
        )
    )
    issues.extend(
        _less_than_error(
            value=_metric(metrics, "torso_alignment"),
            thresholds=[(10.0, "Minor", 4), (6.0, "Moderate", 8), (3.0, "Major", 12)],
            code="torso_too_upright",
            issue="Torso too upright",
            metric="torso_alignment",
            recommendation="Lean the chest slightly forward to stay ready.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "body_balance"),
            thresholds=[(0.10, "Minor", 4), (0.18, "Moderate", 8), (0.26, "Major", 12)],
            code="poor_body_balance",
            issue="Poor body balance",
            metric="body_balance",
            recommendation="Keep hips and shoulders centered over the stance.",
        )
    )
    issues.extend(
        _less_than_error(
            value=_metric(metrics, "hands_height_score"),
            thresholds=[(0.45, "Minor", 3), (0.32, "Moderate", 7), (0.20, "Major", 11)],
            code="hands_too_low",
            issue="Hands too low",
            metric="hands_height_score",
            recommendation="Keep the hands active and higher in the passing lane.",
        )
    )

    return issues


def _score_dribbling(metrics: Mapping[str, float]) -> list[DetectedError]:
    issues: list[DetectedError] = []

    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "knee_bend_angle"),
            thresholds=[(145.0, "Minor", 4), (155.0, "Moderate", 8), (165.0, "Major", 12)],
            code="high_dribble_stance",
            issue="Dribble stance too high",
            metric="knee_bend_angle",
            recommendation="Drop the hips and keep the knees loaded while dribbling.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "ball_body_offset"),
            thresholds=[(0.75, "Minor", 3), (1.00, "Moderate", 7), (1.20, "Major", 11)],
            code="wide_dribble_path",
            issue="Ball path too wide",
            metric="ball_body_offset",
            recommendation="Control the ball closer to your frame.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "body_balance"),
            thresholds=[(0.12, "Minor", 4), (0.20, "Moderate", 8), (0.28, "Major", 12)],
            code="dribble_balance",
            issue="Unbalanced dribble posture",
            metric="body_balance",
            recommendation="Stay centered over your base while handling the ball.",
        )
    )

    return issues


def _score_passing(metrics: Mapping[str, float]) -> list[DetectedError]:
    issues: list[DetectedError] = []

    issues.extend(
        _less_than_error(
            value=_metric(metrics, "elbow_angle"),
            thresholds=[(55.0, "Major", 12), (70.0, "Moderate", 8), (85.0, "Minor", 4)],
            code="pass_not_extended",
            issue="Pass release not extended",
            metric="elbow_angle",
            recommendation="Extend through the pass and finish toward the target.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "wrist_alignment"),
            thresholds=[(0.18, "Minor", 4), (0.28, "Moderate", 8), (0.38, "Major", 12)],
            code="pass_line_off",
            issue="Passing line is off",
            metric="wrist_alignment",
            recommendation="Keep the wrist and elbow aligned through release.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "body_balance"),
            thresholds=[(0.12, "Minor", 4), (0.20, "Moderate", 8), (0.28, "Major", 12)],
            code="pass_balance",
            issue="Unbalanced passing posture",
            metric="body_balance",
            recommendation="Stay balanced through the pass.",
        )
    )

    return issues


def _score_footwork(metrics: Mapping[str, float]) -> list[DetectedError]:
    issues: list[DetectedError] = []

    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "body_balance"),
            thresholds=[(0.12, "Minor", 4), (0.20, "Moderate", 8), (0.30, "Major", 12)],
            code="unstable_stance",
            issue="Unstable stance",
            metric="body_balance",
            recommendation="Stay centered while changing direction.",
        )
    )
    issues.extend(
        _outside_range_error(
            value=_metric(metrics, "feet_spacing"),
            code="poor_foot_spacing",
            issue="Poor foot spacing",
            metric="feet_spacing",
            recommendation="Keep a consistent athletic base during footwork.",
            bands=[
                ((0.90, 1.55), "Minor", 4),
                ((0.80, 1.70), "Moderate", 8),
            ],
            major=("Major", 12),
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "torso_alignment"),
            thresholds=[(14.0, "Minor", 4), (20.0, "Moderate", 8), (26.0, "Major", 12)],
            code="body_leaning_too_much",
            issue="Body leaning too much",
            metric="torso_alignment",
            recommendation="Keep the torso quieter while the feet do the work.",
        )
    )
    issues.extend(
        _greater_than_error(
            value=_metric(metrics, "movement_delay_ms"),
            thresholds=[(250.0, "Minor", 3), (400.0, "Moderate", 7), (550.0, "Major", 11)],
            code="delayed_movement",
            issue="Delayed movement",
            metric="movement_delay_ms",
            recommendation="React earlier and stay loaded for the next move.",
        )
    )
    issues.extend(
        _coordination_error(metrics)
    )

    return issues


def _coordination_error(metrics: Mapping[str, float]) -> list[DetectedError]:
    coordination = _metric(metrics, "ball_body_coordination")
    if coordination is not None:
        return _less_than_error(
            value=coordination,
            thresholds=[(0.70, "Minor", 4), (0.55, "Moderate", 8), (0.40, "Major", 12)],
            code="poor_ball_body_coordination",
            issue="Poor ball-body coordination",
            metric="ball_body_coordination",
            recommendation="Sync the ball with your body rhythm and steps.",
        )

    return []


def _metric(metrics: Mapping[str, float], key: str) -> Optional[float]:
    value = metrics.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _merge_metrics(features: Any, extra_metrics: Optional[Mapping[str, float]]) -> dict[str, float]:
    merged: dict[str, float] = {}

    if isinstance(features, Mapping):
        for key, value in features.items():
            if value is not None:
                merged[str(key)] = value
    else:
        for key in dir(features):
            if key.startswith("_"):
                continue
            value = getattr(features, key, None)
            if callable(value) or value is None:
                continue
            merged[key] = value

    if extra_metrics:
        for key, value in extra_metrics.items():
            if value is not None:
                merged[str(key)] = value

    return merged


def _extract_feedback_deduction(item: Any) -> int:
    if isinstance(item, Mapping):
        return _scale_deduction(item.get("deduction", 0) or 0)
    return _scale_deduction(getattr(item, "deduction", 0) or 0)


def _scale_deduction(raw_deduction: Any) -> int:
    try:
        deduction = int(raw_deduction or 0)
    except (TypeError, ValueError):
        return 0

    if deduction <= 0:
        return 0

    return max(1, round(deduction * DEDUCTION_SCALE))


def _normalize_mode(mode: str) -> str:
    normalized = mode.strip().lower()
    if normalized == "footwork":
        return "basic_footwork"
    return normalized


def _error(
    code: str,
    issue: str,
    severity: SeverityLevel,
    deduction: int,
    metric: str,
    value: Optional[float],
    recommendation: str,
) -> list[DetectedError]:
    return [
        DetectedError(
            code=code,
            issue=issue,
            severity=severity,
            deduction=deduction,
            metric=metric,
            value=None if value is None else round(value, 3),
            recommendation=recommendation,
        )
    ]


def _greater_than_error(
    value: Optional[float],
    thresholds: list[tuple[float, SeverityLevel, int]],
    code: str,
    issue: str,
    metric: str,
    recommendation: str,
) -> list[DetectedError]:
    if value is None:
        return []

    severity: Optional[SeverityLevel] = None
    deduction = 0
    for threshold, current_severity, current_deduction in thresholds:
        if value > threshold:
            severity = current_severity
            deduction = current_deduction
    if severity is None:
        return []
    return _error(code, issue, severity, deduction, metric, value, recommendation)


def _less_than_error(
    value: Optional[float],
    thresholds: list[tuple[float, SeverityLevel, int]],
    code: str,
    issue: str,
    metric: str,
    recommendation: str,
) -> list[DetectedError]:
    if value is None:
        return []

    severity: Optional[SeverityLevel] = None
    deduction = 0
    for threshold, current_severity, current_deduction in thresholds:
        if value < threshold:
            severity = current_severity
            deduction = current_deduction
            break
    if severity is None:
        return []
    return _error(code, issue, severity, deduction, metric, value, recommendation)


def _banded_error(
    value: Optional[float],
    code: str,
    issue: str,
    metric: str,
    recommendation: str,
    bands: list[tuple[float, float, SeverityLevel, int]],
    major: tuple[SeverityLevel, int],
    inverted_range: bool = False,
) -> list[DetectedError]:
    if value is None:
        return []

    for low, high, severity, deduction in bands:
        in_range = low <= value <= high
        if inverted_range:
            if in_range:
                return []
        else:
            if not in_range:
                return _error(code, issue, severity, deduction, metric, value, recommendation)

    if inverted_range:
        return _error(code, issue, major[0], major[1], metric, value, recommendation)
    return []


def _outside_range_error(
    value: Optional[float],
    code: str,
    issue: str,
    metric: str,
    recommendation: str,
    bands: list[tuple[tuple[float, float], SeverityLevel, int]],
    major: tuple[SeverityLevel, int],
) -> list[DetectedError]:
    if value is None:
        return []

    strict_low, strict_high = bands[0][0]
    if strict_low <= value <= strict_high:
        return []

    for (low, high), severity, deduction in bands[1:]:
        if low <= value <= high:
            return _error(code, issue, severity, deduction, metric, value, recommendation)

    return _error(code, issue, major[0], major[1], metric, value, recommendation)
