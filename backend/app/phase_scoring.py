from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Any, Optional


@dataclass(frozen=True)
class PhaseDefinition:
    key: str
    label: str
    focus: str
    cue: str


PHASES_BY_MODE: dict[str, tuple[PhaseDefinition, ...]] = {
    "shooting_form": (
        PhaseDefinition(
            "set_position",
            "Set Position",
            "Player visibility, comfortable knee load, balance, and ball position before the shot.",
            "Start with the full body visible, knees softly loaded, and the ball near the shooting side.",
        ),
        PhaseDefinition(
            "release",
            "Release Point",
            "Elbow-wrist line and release height around the head line.",
            "Stack the wrist and elbow and release near or above the head line.",
        ),
        PhaseDefinition(
            "follow_through",
            "Follow-Through",
            "Body balance after release and control through the finish.",
            "Hold the finish and stay balanced after the ball leaves the hand.",
        ),
    ),
    "dribbling": (
        PhaseDefinition(
            "ready_stance",
            "Ready Stance",
            "Low athletic base before the dribble sequence.",
            "Drop the hips and keep the knees loaded before starting the handle.",
        ),
        PhaseDefinition(
            "ball_control",
            "Ball Path",
            "Visible ball path during low controlled bounces.",
            "Keep the bounce visible, below the hip, and close to the dribbling side.",
        ),
        PhaseDefinition(
            "bounce_rhythm",
            "Bounce Rhythm",
            "Controlled rise and return of the ball between contacts.",
            "Keep the dribble below the hip and avoid letting the ball drift wide.",
        ),
        PhaseDefinition(
            "balance_control",
            "Balance Control",
            "Centered shoulders and hips while maintaining the dribble.",
            "Stay centered over the base so the handle remains stable.",
        ),
    ),
    "passing": (
        PhaseDefinition(
            "load",
            "Load",
            "Ball position before the pass.",
            "Start with the ball visible near the chest-to-shoulder passing window.",
        ),
        PhaseDefinition(
            "release_line",
            "Release Line",
            "Wrist and elbow alignment toward the target.",
            "Point the wrist and elbow through the target line.",
        ),
        PhaseDefinition(
            "arm_extension",
            "Arm Extension",
            "Extension through the pass after the ball leaves the hands.",
            "Extend through the pass instead of stopping the arms early.",
        ),
        PhaseDefinition(
            "balance_finish",
            "Balance Finish",
            "Body balance after the release.",
            "Finish the pass without leaning away from the target.",
        ),
    ),
}


class PhaseScoreAggregator:
    """Groups frame-level scores into drill phases so transition frames do not dominate the result."""

    def __init__(self, mode: str) -> None:
        self.mode = mode if mode in PHASES_BY_MODE else "shooting_form"
        self.phases = PHASES_BY_MODE[self.mode]
        self.samples: dict[str, list[float]] = {phase.key: [] for phase in self.phases}
        self.feedback_counts: dict[str, dict[str, int]] = {phase.key: {} for phase in self.phases}
        self.sample_index = 0
        self.last_phase_key = self.phases[0].key
        self.seen_release = False

    def observe(self, response: Any) -> None:
        phase_key = self._phase_for_response(response)
        self.last_phase_key = phase_key
        self.sample_index += 1

        score = _response_score(response)
        self.samples.setdefault(phase_key, []).append(score)

        feedback_message = _first_feedback_message(response)
        if feedback_message:
            counts = self.feedback_counts.setdefault(phase_key, {})
            counts[feedback_message] = counts.get(feedback_message, 0) + 1

    def build(self) -> list[dict[str, object]]:
        return [self._build_phase(phase) for phase in self.phases]

    def phase_average(self, fallback_score: float = 0.0) -> float:
        return round(float(fallback_score or 0.0), 2)

    def _build_phase(self, phase: PhaseDefinition) -> dict[str, object]:
        values = self.samples.get(phase.key, [])
        if not values:
            return {
                "key": phase.key,
                "label": phase.label,
                "average_score": 0.0,
                "frame_count": 0,
                "status": "not_observed",
                "focus": phase.focus,
                "cue": "Not enough visible frames were captured for this phase.",
            }

        average_score = round(mean(values), 1)
        return {
            "key": phase.key,
            "label": phase.label,
            "average_score": average_score,
            "frame_count": len(values),
            "status": _status_for_score(average_score),
            "focus": phase.focus,
            "cue": _top_feedback(self.feedback_counts.get(phase.key, {})) or phase.cue,
        }

    def _phase_for_response(self, response: Any) -> str:
        pose_detected = bool(getattr(response, "pose_detected", False))
        ball_detected = bool(getattr(response, "ball_detected", False))

        if not pose_detected and not ball_detected:
            return self.last_phase_key
        if not ball_detected and self.seen_release and self.mode in {"shooting_form", "passing"}:
            return "follow_through" if self.mode == "shooting_form" else "balance_finish"

        features = getattr(response, "features", None)
        if self.mode == "dribbling":
            return self._dribbling_phase(features)
        if self.mode == "passing":
            return self._passing_phase(features)
        return self._shooting_phase(features)

    def _shooting_phase(self, features: Any) -> str:
        ball_zone = _feature_value(features, "ball_vertical_zone")
        release_position = _feature_float(features, "ball_release_position")
        release_signal = (
            release_position >= 0
            if release_position is not None
            else ball_zone == "high"
        )

        if self.seen_release and not release_signal:
            return "follow_through"
        if release_signal:
            self.seen_release = True
            return "release"
        return "set_position"

    def _dribbling_phase(self, features: Any) -> str:
        if self.sample_index < 1:
            return "ready_stance"

        ball_zone = _feature_value(features, "ball_vertical_zone")
        body_offset = _feature_float(features, "ball_body_offset")

        if ball_zone == "low":
            return "ball_control"
        if ball_zone == "high" or _is_at_or_above(body_offset, 1.15):
            return "bounce_rhythm"
        return "balance_control"

    def _passing_phase(self, features: Any) -> str:
        body_offset = _feature_float(features, "ball_body_offset")
        elbow_angle = _feature_float(features, "elbow_angle")
        released = _is_at_or_above(body_offset, 1.05)
        extended = _is_at_or_above(elbow_angle, 95.0)

        if self.seen_release and not released:
            return "balance_finish"
        if extended and released:
            self.seen_release = True
            return "arm_extension"
        if released or _is_at_or_above(elbow_angle, 80.0):
            self.seen_release = True
            return "release_line"
        return "load"


def _response_score(response: Any) -> float:
    score = getattr(response, "score", None)
    value = getattr(score, "score", 0)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _first_feedback_message(response: Any) -> str:
    for cue in getattr(response, "feedback", []) or []:
        if getattr(cue, "code", "") == "solid_form":
            continue
        message = str(getattr(cue, "message", "") or "").strip()
        if message:
            return message
    return ""


def _top_feedback(counts: dict[str, int]) -> str:
    if not counts:
        return ""
    return max(counts.items(), key=lambda entry: entry[1])[0]


def _status_for_score(score: float) -> str:
    if score >= 85:
        return "excellent"
    if score >= 72:
        return "good"
    if score >= 58:
        return "developing"
    return "needs_focus"


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
