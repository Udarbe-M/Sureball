from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from .scoring import classify_score


@dataclass(frozen=True)
class CoachingClipValidity:
    average_score: float
    best_score: int
    worst_score: int
    classification: str
    warnings: list[str]


def apply_coaching_clip_validity(
    *,
    mode: str,
    average_score: float,
    best_score: int,
    worst_score: int,
    analyzed_frames: int,
    pose_frames: int,
    ball_frames: int,
    action_label: Optional[str] = None,
    action_count: int = 0,
    shooting_evidence_frames: int = 0,
) -> CoachingClipValidity:
    warnings: list[str] = []
    score_cap: Optional[float] = None

    def add_warning(message: str, cap: float) -> None:
        nonlocal score_cap
        warnings.append(message)
        score_cap = cap if score_cap is None else min(score_cap, cap)

    pose_ratio = _ratio(pose_frames, analyzed_frames)
    ball_ratio = _ratio(ball_frames, analyzed_frames)
    shooting_evidence_ratio = _ratio(shooting_evidence_frames, analyzed_frames)

    if analyzed_frames < 3:
        add_warning("Not enough usable frames were analyzed. Use a longer clip with the player and ball visible.", 25)
    elif pose_ratio < 0.15 and ball_ratio < 0.15:
        add_warning("No valid basketball action detected. Make sure a player and basketball are visible.", 12)
    elif pose_ratio < 0.15:
        add_warning("No athlete detected. Make sure the player is fully visible in frame.", 18)
    elif ball_ratio < 0.15:
        add_warning("No basketball detected. Keep the ball visible throughout the clip.", 22)
    else:
        if pose_ratio < 0.45:
            add_warning("The player was not visible enough for reliable coaching. Move farther back and keep the full body in frame.", 40)
        if ball_ratio < 0.35:
            add_warning("The basketball was not visible enough for reliable coaching. Keep the ball in frame.", 45)

    if not warnings and mode in {"dribbling", "passing"} and action_label and action_count <= 0:
        action_name = action_label.lower()
        add_warning(
            f"No clear {action_name} detected. Choose {mode.replace('_', ' ')} mode only when the clip shows that action.",
            55,
        )

    has_shot_counter_evidence = mode == "shooting_form" and action_count > 0
    if not warnings and mode == "shooting_form" and shooting_evidence_ratio < 0.2 and not has_shot_counter_evidence:
        add_warning("No clear shooting setup detected. Show the player with the ball in a shooting motion.", 55)

    adjusted_average = average_score
    if score_cap is not None:
        adjusted_average = min(adjusted_average, score_cap)

    adjusted_average = round(max(0.0, adjusted_average), 2)
    adjusted_best = int(min(best_score, round(adjusted_average if score_cap is not None else best_score)))
    adjusted_worst = int(min(worst_score, round(adjusted_average))) if analyzed_frames else 0

    return CoachingClipValidity(
        average_score=adjusted_average,
        best_score=max(0, adjusted_best),
        worst_score=max(0, adjusted_worst),
        classification=classify_score(adjusted_average),
        warnings=warnings,
    )


def merge_validity_warnings(warnings: Sequence[str], dominant_feedback: Sequence[str], *, limit: int = 3) -> list[str]:
    merged: list[str] = []
    for message in [*warnings, *dominant_feedback]:
        if message == "Strong overall movement quality detected." and warnings:
            continue
        if message not in merged:
            merged.append(message)
        if len(merged) >= limit:
            break
    return merged or ["Strong overall movement quality detected."]


def _ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator
