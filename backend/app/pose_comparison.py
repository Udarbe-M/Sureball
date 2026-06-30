from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Any, Optional


@dataclass(frozen=True)
class ReferenceMetric:
    key: str
    label: str
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    unit: str = "ratio"
    coaching_cue: str = ""


REFERENCE_METRICS: dict[str, tuple[ReferenceMetric, ...]] = {
    "shooting_form": (
        ReferenceMetric(
            "wrist_alignment",
            "Elbow-Wrist Line",
            maximum=0.28,
            coaching_cue="Stack the shooting wrist above the elbow.",
        ),
        ReferenceMetric(
            "knee_bend_angle",
            "Comfortable Knee Load",
            maximum=165.0,
            unit="degrees",
            coaching_cue="Use a natural knee bend before the ball rises; the app does not require a deep squat.",
        ),
        ReferenceMetric(
            "body_balance",
            "Body Balance",
            maximum=0.22,
            coaching_cue="Keep the shoulders and hips level through the shot.",
        ),
    ),
    "dribbling": (
        ReferenceMetric(
            "knee_bend_angle",
            "Athletic Knee Bend",
            maximum=155.0,
            unit="degrees",
            coaching_cue="Drop the hips and maintain a low athletic stance.",
        ),
        ReferenceMetric(
            "ball_body_offset",
            "Dribble Path",
            maximum=1.15,
            coaching_cue="Keep the bounce close to the body line.",
        ),
        ReferenceMetric(
            "body_balance",
            "Body Balance",
            maximum=0.22,
            coaching_cue="Keep the shoulders and hips centered over the base.",
        ),
    ),
    "passing": (
        ReferenceMetric(
            "elbow_angle",
            "Arm Extension",
            minimum=80.0,
            unit="degrees",
            coaching_cue="Extend the arms through the target line.",
        ),
        ReferenceMetric(
            "wrist_alignment",
            "Release Line",
            maximum=0.34,
            coaching_cue="Keep the wrist and elbow on a direct passing line.",
        ),
        ReferenceMetric(
            "body_balance",
            "Body Balance",
            maximum=0.22,
            coaching_cue="Finish the pass without leaning away from the target.",
        ),
    ),
}


class PoseComparisonAggregator:
    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.metrics = REFERENCE_METRICS.get(mode, REFERENCE_METRICS["shooting_form"])
        self.values: dict[str, list[float]] = {metric.key: [] for metric in self.metrics}

    def observe(self, features: Any) -> None:
        for metric in self.metrics:
            value = getattr(features, metric.key, None)
            if value is None:
                continue
            try:
                self.values[metric.key].append(float(value))
            except (TypeError, ValueError):
                continue

    def build(self) -> list[dict[str, object]]:
        return [self._build_metric(metric) for metric in self.metrics]

    def _build_metric(self, metric: ReferenceMetric) -> dict[str, object]:
        values = self.values[metric.key]
        if not values:
            return {
                "key": metric.key,
                "label": metric.label,
                "actual_value": None,
                "actual_display": "Not detected",
                "reference_display": _reference_display(metric),
                "match_rate": 0.0,
                "observed_frames": 0,
                "status": "insufficient",
                "coaching_cue": metric.coaching_cue,
            }

        actual_value = round(float(median(values)), 2)
        matched = sum(1 for value in values if _matches_reference(value, metric))
        match_rate = round((matched / len(values)) * 100.0, 1)
        if match_rate >= 70.0:
            status = "matched"
        elif match_rate >= 45.0:
            status = "close"
        else:
            status = "needs_focus"

        return {
            "key": metric.key,
            "label": metric.label,
            "actual_value": actual_value,
            "actual_display": _actual_display(actual_value, metric),
            "reference_display": _reference_display(metric),
            "match_rate": match_rate,
            "observed_frames": len(values),
            "status": status,
            "coaching_cue": metric.coaching_cue,
        }


def _matches_reference(value: float, metric: ReferenceMetric) -> bool:
    if metric.minimum is not None and value < metric.minimum:
        return False
    if metric.maximum is not None and value > metric.maximum:
        return False
    return True


def _actual_display(value: float, metric: ReferenceMetric) -> str:
    if metric.unit == "degrees":
        return f"{value:.1f} degrees"
    return f"{value:.2f} shoulder widths"


def _reference_display(metric: ReferenceMetric) -> str:
    if metric.minimum is not None and metric.maximum is not None:
        target = f"{metric.minimum:g} to {metric.maximum:g}"
    elif metric.minimum is not None:
        target = f"{metric.minimum:g} or more"
    elif metric.maximum is not None:
        target = f"{metric.maximum:g} or less"
    else:
        target = "Observed"
    return f"{target} degrees" if metric.unit == "degrees" else f"{target} shoulder widths"
