from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional, Sequence

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
    shooting_setup_frames: int = 0,
    shooting_release_frames: int = 0,
    shooting_follow_through_frames: int = 0,
    shooting_setup_score: Optional[float] = None,
    shooting_follow_through_score: Optional[float] = None,
    pose_comparison: Optional[Sequence[Mapping[str, object]]] = None,
) -> CoachingClipValidity:
    warnings: list[str] = []
    score_cap: Optional[float] = None

    def add_warning(message: str, cap: float) -> None:
        nonlocal score_cap
        warnings.append(message)
        score_cap = cap if score_cap is None else min(score_cap, cap)

    def add_note(message: str) -> None:
        warnings.append(message)

    pose_ratio = _ratio(pose_frames, analyzed_frames)
    ball_ratio = _ratio(ball_frames, analyzed_frames)

    if analyzed_frames < 3:
        add_warning("Not enough usable frames were analyzed. Use a longer clip with the player and ball visible.", 25)
    elif pose_ratio < 0.15 and ball_ratio < 0.15:
        add_warning("No valid basketball action detected. Make sure a player and basketball are visible.", 12)
    elif pose_ratio < 0.15:
        add_warning("No athlete detected. Make sure the player is fully visible in frame.", 18)
    elif ball_ratio < 0.15:
        if mode == "shooting_form":
            add_note("No basketball detected. Technique score is based on visible body form, but shot-result review may be unreliable.")
        else:
            add_warning("No basketball detected. Keep the ball visible throughout the clip.", 22)
    else:
        if pose_ratio < 0.45:
            add_warning("The player was not visible enough for reliable coaching. Move farther back and keep the full body in frame.", 40)
        if ball_ratio < 0.35:
            if mode == "shooting_form":
                add_note("The basketball was not visible enough for reliable shot-result review. Keep the ball in frame.")
            else:
                add_warning("The basketball was not visible enough for reliable coaching. Keep the ball in frame.", 45)

    if not warnings and mode in {"dribbling", "passing"} and action_label and action_count <= 0:
        action_name = action_label.lower()
        add_warning(
            f"No clear {action_name} detected. Choose {mode.replace('_', ' ')} mode only when the clip shows that action.",
            55,
        )

    if mode == "shooting_form" and pose_ratio >= 0.45:
        has_release_evidence = shooting_evidence_frames > 0 or shooting_release_frames > 0
        has_complete_sequence = (
            shooting_setup_frames > 0
            and shooting_release_frames > 0
            and shooting_follow_through_frames > 0
        )

        if not has_release_evidence:
            add_warning(
                "No clear shooting motion detected. Standing or holding the ball is capped until the release sequence is shown.",
                55,
            )
        elif not has_complete_sequence:
            add_warning(
                "Partial shooting motion detected. Show setup, release, and follow-through in sequence for an excellent score.",
                84,
            )
        else:
            if shooting_setup_score is not None:
                if shooting_setup_score < 40.0:
                    add_warning(
                        "Set position was weak or partly out of frame, so the score is capped in the Good range.",
                        80,
                    )
                elif shooting_setup_score < 58.0:
                    add_warning(
                        "Set position needs more consistency before the score can reach Excellent.",
                        84,
                    )
            if shooting_follow_through_frames < 8:
                add_warning(
                    "Follow-through was captured for only a few frames, so the score is capped below near-perfect.",
                    90,
                )
            elif shooting_follow_through_score is not None:
                if shooting_follow_through_score < 58.0:
                    add_warning(
                        "Follow-through was weak, so the score is capped below Excellent.",
                        82,
                    )
                elif shooting_follow_through_score < 70.0:
                    add_warning(
                        "Follow-through needs more balance and control before the score can reach Excellent.",
                        84,
                    )
            if ball_ratio < 0.80:
                add_warning(
                    "Basketball visibility was limited, so the score is capped below near-perfect confidence.",
                    94,
                )

        for message, cap in _shooting_reference_caps(pose_comparison):
            add_warning(message, cap)

    adjusted_average = average_score
    if score_cap is not None:
        adjusted_average = min(adjusted_average, score_cap)

    adjusted_average = round(max(0.0, adjusted_average), 2)
    adjusted_best = int(best_score if analyzed_frames else 0)
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


def _shooting_reference_caps(
    pose_comparison: Optional[Sequence[Mapping[str, object]]],
) -> list[tuple[str, float]]:
    if not pose_comparison:
        return []

    metrics = {str(item.get("key") or ""): item for item in pose_comparison}
    caps: list[tuple[str, float]] = []

    knee = metrics.get("knee_bend_angle")
    knee_rate = _match_rate(knee)
    if knee_rate is None:
        caps.append(("Knee-load landmarks were not reliable enough for a near-perfect shooting score.", 90))
    elif knee_rate < 25.0:
        caps.append(("Knee load was far from the reference pose, so the score is capped below near-perfect.", 86))
    elif knee_rate < 45.0:
        caps.append(("Knee load only partially matched the reference pose, so the score is capped.", 90))
    elif knee_rate < 70.0:
        caps.append(("Knee load was close but not consistent enough for a near-perfect score.", 94))

    wrist = metrics.get("wrist_alignment")
    wrist_rate = _match_rate(wrist)
    if wrist_rate is None:
        caps.append(("Elbow-wrist landmarks were not reliable enough for a near-perfect shooting score.", 90))
    elif wrist_rate < 15.0:
        caps.append(("Elbow-wrist alignment was far from the reference pose, so the score is capped in the Good range.", 80))
    elif wrist_rate < 30.0:
        caps.append(("Elbow-wrist alignment was far from the reference pose, so the score is capped.", 84))
    elif wrist_rate < 40.0:
        caps.append(("Elbow-wrist alignment was far from the reference pose, so the score is capped.", 88))
    elif wrist_rate < 60.0:
        caps.append(("Elbow-wrist alignment only partially matched the reference pose, so the score is capped.", 92))
    elif wrist_rate < 70.0:
        caps.append(("Elbow-wrist alignment was close but not consistent enough for a near-perfect score.", 95))

    balance = metrics.get("body_balance")
    balance_rate = _match_rate(balance)
    if balance_rate is not None:
        if balance_rate < 35.0:
            caps.append(("Body balance was inconsistent, so the score is capped in the Good range.", 82))
        elif balance_rate < 45.0:
            caps.append(("Body balance was inconsistent, so the score is capped.", 90))
        elif balance_rate < 70.0:
            caps.append(("Body balance was close but not consistent enough for a near-perfect score.", 94))

    return caps


def _match_rate(metric: Optional[Mapping[str, object]]) -> Optional[float]:
    if not metric:
        return None
    try:
        observed_frames = int(metric.get("observed_frames") or 0)
    except (TypeError, ValueError):
        observed_frames = 0
    if observed_frames <= 0:
        return None
    try:
        return float(metric.get("match_rate") or 0.0)
    except (TypeError, ValueError):
        return 0.0
