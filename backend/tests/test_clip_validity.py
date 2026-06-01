import unittest

from backend.app.clip_validity import apply_coaching_clip_validity, merge_validity_warnings
from backend.app.shot_training import _shot_training_validity_warning


class ClipValidityTests(unittest.TestCase):
    def test_missing_player_and_ball_caps_coaching_score(self):
        result = apply_coaching_clip_validity(
            mode="passing",
            average_score=92,
            best_score=98,
            worst_score=80,
            analyzed_frames=20,
            pose_frames=0,
            ball_frames=0,
            action_label="Passes",
            action_count=0,
        )

        self.assertEqual(result.average_score, 12)
        self.assertEqual(result.classification, "Poor")
        self.assertIn("No valid basketball action detected", result.warnings[0])

    def test_no_dribbling_action_caps_otherwise_visible_clip(self):
        result = apply_coaching_clip_validity(
            mode="dribbling",
            average_score=88,
            best_score=95,
            worst_score=76,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Dribbles",
            action_count=0,
        )

        self.assertEqual(result.average_score, 55)
        self.assertEqual(result.classification, "Poor")
        self.assertIn("No clear dribbles detected", result.warnings[0])

    def test_shooting_counter_evidence_prevents_false_setup_warning(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=82,
            best_score=90,
            worst_score=70,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Shots",
            action_count=3,
            shooting_evidence_frames=0,
        )

        self.assertEqual(result.average_score, 82)
        self.assertEqual(result.classification, "Good")
        self.assertEqual(result.warnings, [])

    def test_shooting_visible_setup_evidence_prevents_false_setup_warning(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=82,
            best_score=90,
            worst_score=70,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Shots",
            action_count=0,
            shooting_evidence_frames=4,
        )

        self.assertEqual(result.average_score, 82)
        self.assertEqual(result.classification, "Good")
        self.assertEqual(result.warnings, [])

    def test_validity_warnings_take_priority_over_normal_feedback(self):
        feedback = merge_validity_warnings(
            ["No basketball detected. Keep the ball visible throughout the clip."],
            ["Strong overall movement quality detected.", "Keep your elbow aligned."],
        )

        self.assertEqual(feedback[0], "No basketball detected. Keep the ball visible throughout the clip.")
        self.assertNotIn("Strong overall movement quality detected.", feedback)

    def test_shot_training_warns_when_no_shot_attempt_is_detected(self):
        warning = _shot_training_validity_warning(
            processed_frames=120,
            player_frames=100,
            ball_frames=100,
            shot_signal_frames=0,
            attempts=0,
        )

        self.assertIn("No shot attempt detected", warning)


if __name__ == "__main__":
    unittest.main()
