from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .schemas import CoachingMode, FeatureSet, FeedbackCue
from .utils import angle, ball_center_from_box, distance, midpoint, safe_ratio, select_shooting_side, vertical_angle


def extract_features(mode: CoachingMode, landmarks: Dict[str, Dict[str, float]], ball_box: Optional[Dict[str, float]]) -> FeatureSet:
    shoulder_width = 1.0
    if "left_shoulder" in landmarks and "right_shoulder" in landmarks:
        shoulder_width = max(distance(landmarks["left_shoulder"], landmarks["right_shoulder"]), 1.0)

    ball_center = ball_center_from_box(ball_box)
    shooting_side = select_shooting_side(landmarks, ball_center)
    side = _active_side_points(landmarks, shooting_side)

    features = FeatureSet()

    if all(key in side for key in ("shoulder", "elbow", "hip")):
        features.shoulder_angle = angle(side["elbow"], side["shoulder"], side["hip"])

    if all(key in side for key in ("shoulder", "elbow", "wrist")):
        features.elbow_angle = angle(side["shoulder"], side["elbow"], side["wrist"])
        features.wrist_alignment = abs(side["wrist"]["x"] - side["elbow"]["x"]) / shoulder_width

    if all(key in side for key in ("hip", "knee", "ankle")):
        features.knee_bend_angle = angle(side["hip"], side["knee"], side["ankle"])

    if "left_shoulder" in landmarks and "right_shoulder" in landmarks and "left_hip" in landmarks and "right_hip" in landmarks:
        shoulder_mid = midpoint(landmarks["left_shoulder"], landmarks["right_shoulder"])
        hip_mid = midpoint(landmarks["left_hip"], landmarks["right_hip"])
        features.torso_alignment = vertical_angle(hip_mid, shoulder_mid)

    if "left_ankle" in landmarks and "right_ankle" in landmarks:
        feet_distance = distance(landmarks["left_ankle"], landmarks["right_ankle"])
        features.feet_spacing = safe_ratio(feet_distance, shoulder_width)

    if ball_center and "left_wrist" in landmarks and "right_wrist" in landmarks:
        left_dist = distance(ball_center, landmarks["left_wrist"])
        right_dist = distance(ball_center, landmarks["right_wrist"])
        features.ball_to_wrist_distance = min(left_dist, right_dist) / shoulder_width

    if ball_center and "nose" in landmarks:
        features.ball_release_position = landmarks["nose"]["y"] - ball_center["y"]

    if (
        ball_center
        and "left_shoulder" in landmarks
        and "right_shoulder" in landmarks
        and "left_hip" in landmarks
        and "right_hip" in landmarks
    ):
        shoulder_mid = midpoint(landmarks["left_shoulder"], landmarks["right_shoulder"])
        hip_mid = midpoint(landmarks["left_hip"], landmarks["right_hip"])
        torso_mid = midpoint(shoulder_mid, hip_mid)
        features.ball_body_offset = abs(ball_center["x"] - torso_mid["x"]) / shoulder_width
        features.ball_vertical_zone = _classify_ball_vertical_zone(ball_center, shoulder_mid, hip_mid)

    if "left_shoulder" in landmarks and "right_shoulder" in landmarks and "left_hip" in landmarks and "right_hip" in landmarks:
        shoulder_level_delta = abs(landmarks["left_shoulder"]["y"] - landmarks["right_shoulder"]["y"])
        hip_level_delta = abs(landmarks["left_hip"]["y"] - landmarks["right_hip"]["y"])
        features.body_balance = (shoulder_level_delta + hip_level_delta) / max(shoulder_width, 1.0)
        features.symmetry_score = max(0.0, 1.0 - features.body_balance)

    return features


def generate_feedback(mode: CoachingMode, features: FeatureSet, ball_detected: bool) -> Tuple[List[FeedbackCue], str]:
    if mode == "unified_coaching":
        return _generate_unified_feedback(features, ball_detected)

    return _generate_mode_feedback(mode, features, ball_detected)


def _generate_unified_feedback(features: FeatureSet, ball_detected: bool) -> Tuple[List[FeedbackCue], str]:
    shooting_feedback, shooting_summary = _generate_mode_feedback("shooting_form", features, ball_detected)
    dribbling_feedback, dribbling_summary = _generate_mode_feedback("dribbling", features, ball_detected)
    passing_feedback, passing_summary = _generate_mode_feedback("passing", features, ball_detected)

    combined_feedback: List[FeedbackCue] = []
    seen_codes: set[str] = set()
    for cue in [*shooting_feedback, *dribbling_feedback, *passing_feedback]:
        if cue.code == "solid_form":
            continue
        if cue.code in seen_codes:
            continue
        seen_codes.add(cue.code)
        combined_feedback.append(cue)

    if not ball_detected:
        combined_feedback = [
            cue
            for cue in combined_feedback
            if cue.code not in {"ball_not_detected", "dribbling_ball_not_detected", "passing_ball_not_detected"}
        ]
        combined_feedback.append(
            FeedbackCue(
                code="unified_ball_not_detected",
                message="Basketball not clearly detected. Keep the ball visible to unlock shooting, dribbling, and passing feedback.",
                severity="low",
                deduction=6,
            )
        )

    if not combined_feedback:
        combined_feedback.append(
            FeedbackCue(
                code="solid_form",
                message="Strong rep across shooting, dribbling, and passing. Maintain this posture and rhythm.",
                severity="low",
                deduction=0,
            )
        )

    summary = (
        "Unified coaching reviewed the rep across shooting, dribbling, and passing. "
        f"{shooting_summary} {dribbling_summary} {passing_summary}"
    )
    return combined_feedback, summary


def _generate_mode_feedback(mode: CoachingMode, features: FeatureSet, ball_detected: bool) -> Tuple[List[FeedbackCue], str]:
    feedback: List[FeedbackCue] = []

    if mode == "shooting_form":
        if features.wrist_alignment is not None and features.wrist_alignment > 0.28:
            feedback.append(
                FeedbackCue(
                    code="shooting_elbow_alignment",
                    message="Keep your shooting elbow aligned.",
                    severity="high",
                    deduction=12,
                )
            )
        if features.knee_bend_angle is not None and features.knee_bend_angle > 150:
            feedback.append(
                FeedbackCue(
                    code="shooting_knee_bend",
                    message="Bend your knees more before the shot.",
                    severity="medium",
                    deduction=10,
                )
            )
        if features.ball_to_wrist_distance is not None and features.ball_to_wrist_distance > 0.42:
            feedback.append(
                FeedbackCue(
                    code="shooting_ball_control",
                    message="Keep the ball closer to your shooting hand.",
                    severity="medium",
                    deduction=10,
                )
            )
        if features.ball_release_position is not None and features.ball_release_position < 0:
            feedback.append(
                FeedbackCue(
                    code="shooting_release_height",
                    message="Release the ball higher, near or above your head line.",
                    severity="medium",
                    deduction=8,
                )
            )
        if features.body_balance is not None and features.body_balance > 0.22:
            feedback.append(
                FeedbackCue(
                    code="shooting_balance",
                    message="Maintain body balance through the shot.",
                    severity="medium",
                    deduction=8,
                )
            )
        summary = "Shooting form evaluated with emphasis on elbow alignment, knee bend, ball control, and balance."

    elif mode == "dribbling":
        if features.knee_bend_angle is not None and features.knee_bend_angle > 155:
            feedback.append(
                FeedbackCue(
                    code="dribbling_ready_knees",
                    message="Drop your hips and keep a stronger knee bend while dribbling.",
                    severity="medium",
                    deduction=10,
                )
            )
        if features.body_balance is not None and features.body_balance > 0.22:
            feedback.append(
                FeedbackCue(
                    code="dribbling_balance",
                    message="Stay centered over your base so the handle stays controlled.",
                    severity="medium",
                    deduction=8,
                )
            )
        if ball_detected:
            if features.ball_to_wrist_distance is not None and features.ball_to_wrist_distance > 0.6:
                feedback.append(
                    FeedbackCue(
                        code="dribbling_ball_connection",
                        message="Keep the ball closer to your hand through the dribble.",
                        severity="high",
                        deduction=12,
                    )
                )
            if features.ball_vertical_zone == "high":
                feedback.append(
                    FeedbackCue(
                        code="dribbling_ball_height",
                        message="Keep the dribble lower, around your hip or below.",
                        severity="medium",
                        deduction=10,
                    )
                )
            if features.ball_body_offset is not None and features.ball_body_offset > 1.15:
                feedback.append(
                    FeedbackCue(
                        code="dribbling_ball_path",
                        message="Bring the ball path closer to your body instead of letting it drift wide.",
                        severity="medium",
                        deduction=8,
                    )
                )
        else:
            feedback.append(
                FeedbackCue(
                    code="dribbling_ball_not_detected",
                    message="Basketball not detected. Keep the ball visible so YOLOv11 can track your handle.",
                    severity="low",
                    deduction=6,
                )
            )
        summary = "Dribbling analyzed with YOLOv11 ball tracking and MediaPipe pose for handle control, stance, and balance."

    elif mode == "passing":
        if features.elbow_angle is not None and features.elbow_angle < 80:
            feedback.append(
                FeedbackCue(
                    code="passing_elbow_extension",
                    message="Extend through the pass so your arm finishes toward the target.",
                    severity="medium",
                    deduction=10,
                )
            )
        if features.wrist_alignment is not None and features.wrist_alignment > 0.34:
            feedback.append(
                FeedbackCue(
                    code="passing_release_line",
                    message="Keep your wrist and elbow on a cleaner passing line.",
                    severity="medium",
                    deduction=8,
                )
            )
        if features.body_balance is not None and features.body_balance > 0.22:
            feedback.append(
                FeedbackCue(
                    code="passing_balance",
                    message="Stay balanced through the pass instead of leaning out of frame.",
                    severity="medium",
                    deduction=8,
                )
            )
        if ball_detected:
            if features.ball_to_wrist_distance is not None and features.ball_to_wrist_distance > 0.5:
                feedback.append(
                    FeedbackCue(
                        code="passing_ball_connection",
                        message="Keep the ball connected to your passing hand before release.",
                        severity="high",
                        deduction=12,
                    )
                )
            if features.ball_vertical_zone == "low":
                feedback.append(
                    FeedbackCue(
                        code="passing_ball_window",
                        message="Bring the pass into a stronger chest-to-shoulder passing window.",
                        severity="medium",
                        deduction=8,
                    )
                )
            if features.ball_body_offset is not None and features.ball_body_offset > 1.25:
                feedback.append(
                    FeedbackCue(
                        code="passing_ball_path",
                        message="Keep the ball path tighter so the pass starts from your frame.",
                        severity="medium",
                        deduction=8,
                    )
                )
        else:
            feedback.append(
                FeedbackCue(
                    code="passing_ball_not_detected",
                    message="Basketball not detected. Keep the ball visible so YOLOv11 can evaluate the pass.",
                    severity="low",
                    deduction=6,
                )
            )
        summary = "Passing analyzed with YOLOv11 ball tracking and MediaPipe pose for release line, ball control, and balance."

    elif mode == "defensive_stance":
        if features.feet_spacing is not None and features.feet_spacing < 1.1:
            feedback.append(
                FeedbackCue(
                    code="defense_stance_width",
                    message="Widen your defensive stance.",
                    severity="high",
                    deduction=14,
                )
            )
        if features.knee_bend_angle is not None and features.knee_bend_angle > 145:
            feedback.append(
                FeedbackCue(
                    code="defense_knee_bend",
                    message="Sit lower and bend your knees more.",
                    severity="high",
                    deduction=12,
                )
            )
        if features.torso_alignment is not None and features.torso_alignment < 4:
            feedback.append(
                FeedbackCue(
                    code="defense_torso_engagement",
                    message="Lean your torso forward slightly to stay ready.",
                    severity="medium",
                    deduction=8,
                )
            )
        if features.body_balance is not None and features.body_balance > 0.18:
            feedback.append(
                FeedbackCue(
                    code="defense_balance",
                    message="Keep your shoulders and hips level for better balance.",
                    severity="medium",
                    deduction=8,
                )
            )
        if ball_detected:
            if features.ball_vertical_zone == "high":
                feedback.append(
                    FeedbackCue(
                        code="defense_ball_height",
                        message="Keep the ball lower in your stance so you stay ready and protect it.",
                        severity="medium",
                        deduction=8,
                    )
                )
            if features.ball_body_offset is not None and features.ball_body_offset > 1.0:
                feedback.append(
                    FeedbackCue(
                        code="defense_ball_security",
                        message="Keep the ball tighter to your body while holding the stance.",
                        severity="medium",
                        deduction=8,
                    )
                )
        else:
            feedback.append(
                FeedbackCue(
                    code="defense_ball_not_detected",
                    message="Basketball not detected. Keep the ball in frame for stance plus ball-security feedback.",
                    severity="low",
                    deduction=4,
                )
            )
        summary = "Defensive stance analyzed using stance width, knee bend, torso readiness, balance, and ball security."

    else:
        if features.feet_spacing is not None and not (0.9 <= features.feet_spacing <= 1.45):
            feedback.append(
                FeedbackCue(
                    code="footwork_spacing",
                    message="Keep your feet at a stable shoulder-width base.",
                    severity="medium",
                    deduction=10,
                )
            )
        if features.torso_alignment is not None and features.torso_alignment > 16:
            feedback.append(
                FeedbackCue(
                    code="footwork_torso_control",
                    message="Keep your torso more upright during the movement.",
                    severity="medium",
                    deduction=8,
                )
            )
        if features.knee_bend_angle is not None and features.knee_bend_angle > 160:
            feedback.append(
                FeedbackCue(
                    code="footwork_ready_knees",
                    message="Stay more athletic by keeping a slight knee bend.",
                    severity="medium",
                    deduction=10,
                )
            )
        if features.body_balance is not None and features.body_balance > 0.2:
            feedback.append(
                FeedbackCue(
                    code="footwork_balance",
                    message="Maintain body balance while moving your feet.",
                    severity="medium",
                    deduction=10,
                )
            )
        if ball_detected:
            if features.ball_to_wrist_distance is not None and features.ball_to_wrist_distance > 0.72:
                feedback.append(
                    FeedbackCue(
                        code="footwork_ball_control",
                        message="Keep the ball connected to your hands while moving through the drill.",
                        severity="medium",
                        deduction=8,
                    )
                )
            if features.ball_body_offset is not None and features.ball_body_offset > 1.15:
                feedback.append(
                    FeedbackCue(
                        code="footwork_ball_path",
                        message="Keep the ball closer to your frame instead of letting it drift wide.",
                        severity="medium",
                        deduction=8,
                    )
                )
        else:
            feedback.append(
                FeedbackCue(
                    code="footwork_ball_not_detected",
                    message="Basketball not detected. Keep it visible if you want movement plus ball-control feedback.",
                    severity="low",
                    deduction=4,
                )
            )
        summary = "Basic footwork checked for base, posture control, ready knees, symmetry, and ball control."

    if not ball_detected and mode == "shooting_form":
        feedback.append(
            FeedbackCue(
                code="ball_not_detected",
                message="Basketball not clearly detected. Keep the ball visible to the camera.",
                severity="low",
                deduction=6,
            )
        )

    if not feedback:
        feedback.append(
            FeedbackCue(
                code="solid_form",
                message="Strong rep. Maintain this posture and rhythm.",
                severity="low",
                deduction=0,
            )
        )

    return feedback, summary


def _active_side_points(landmarks: Dict[str, Dict[str, float]], side: str) -> Dict[str, Dict[str, float]]:
    prefix = "left" if side == "left" else "right"
    mapping = {
        "shoulder": f"{prefix}_shoulder",
        "elbow": f"{prefix}_elbow",
        "wrist": f"{prefix}_wrist",
        "hip": f"{prefix}_hip",
        "knee": f"{prefix}_knee",
        "ankle": f"{prefix}_ankle",
    }
    return {
        short_name: landmarks[full_name]
        for short_name, full_name in mapping.items()
        if full_name in landmarks
    }


def _classify_ball_vertical_zone(
    ball_center: Dict[str, float],
    shoulder_mid: Dict[str, float],
    hip_mid: Dict[str, float],
) -> str:
    if ball_center["y"] <= shoulder_mid["y"]:
        return "high"
    if ball_center["y"] <= hip_mid["y"]:
        return "torso"
    return "low"
