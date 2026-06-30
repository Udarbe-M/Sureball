import unittest

from backend.app.clip_validity import apply_coaching_clip_validity, merge_validity_warnings


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

    def test_shooting_counter_alone_does_not_unlock_excellent_score(self):
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

        self.assertEqual(result.average_score, 55)
        self.assertEqual(result.classification, "Poor")
        self.assertIn("No clear shooting motion detected", result.warnings[0])

    def test_partial_shooting_sequence_caps_below_excellent(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=92,
            best_score=96,
            worst_score=70,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Shots",
            action_count=2,
            shooting_evidence_frames=4,
            shooting_setup_frames=10,
            shooting_release_frames=4,
            shooting_follow_through_frames=0,
        )

        self.assertEqual(result.average_score, 84)
        self.assertEqual(result.classification, "Good")
        self.assertIn("Partial shooting motion detected", result.warnings[0])

    def test_best_score_preserves_best_frame_while_average_is_capped(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=70,
            best_score=96,
            worst_score=40,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Shots",
            action_count=1,
            shooting_evidence_frames=4,
            shooting_setup_frames=10,
            shooting_release_frames=4,
            shooting_follow_through_frames=0,
        )

        self.assertEqual(result.average_score, 70)
        self.assertEqual(result.best_score, 96)
        self.assertEqual(result.classification, "Needs Improvement")

    def test_shooting_low_ball_visibility_warns_without_capping_form_score(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=84,
            best_score=92,
            worst_score=72,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=2,
            action_label="Shots",
            action_count=0,
            shooting_evidence_frames=1,
        )

        self.assertEqual(result.average_score, 84)
        self.assertEqual(result.classification, "Good")
        self.assertIn("shot-result review may be unreliable", result.warnings[0])

    def test_standing_still_in_shooting_mode_cannot_score_excellent(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=94,
            best_score=100,
            worst_score=90,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Shots",
            action_count=0,
            shooting_evidence_frames=0,
        )

        self.assertEqual(result.average_score, 55)
        self.assertEqual(result.classification, "Poor")
        self.assertIn("No clear shooting motion detected", result.warnings[0])

    def test_release_evidence_allows_excellent_shooting_score(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=94,
            best_score=100,
            worst_score=90,
            analyzed_frames=20,
            pose_frames=20,
            ball_frames=20,
            action_label="Shots",
            action_count=0,
            shooting_evidence_frames=1,
            shooting_setup_frames=8,
            shooting_release_frames=4,
            shooting_follow_through_frames=8,
        )

        self.assertEqual(result.average_score, 94)
        self.assertEqual(result.classification, "Excellent")
        self.assertEqual(result.warnings, [])

    def test_reference_pose_mismatch_caps_near_perfect_shooting_score(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=97.32,
            best_score=100,
            worst_score=86,
            analyzed_frames=132,
            pose_frames=132,
            ball_frames=103,
            action_label="Shots",
            action_count=1,
            shooting_evidence_frames=103,
            shooting_setup_frames=23,
            shooting_release_frames=103,
            shooting_follow_through_frames=6,
            pose_comparison=[
                {"key": "wrist_alignment", "match_rate": 46.2, "observed_frames": 39},
                {"key": "knee_bend_angle", "match_rate": 15.2, "observed_frames": 132},
                {"key": "body_balance", "match_rate": 94.7, "observed_frames": 132},
            ],
        )

        self.assertEqual(result.average_score, 86)
        self.assertEqual(result.classification, "Excellent")
        self.assertTrue(any("Knee load was far" in warning for warning in result.warnings))

    def test_weak_setup_alignment_and_balance_cap_multishot_clip_in_good_range(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=81.23,
            best_score=100,
            worst_score=12,
            analyzed_frames=288,
            pose_frames=255,
            ball_frames=239,
            action_label="Shots",
            action_count=4,
            shooting_evidence_frames=217,
            shooting_setup_frames=10,
            shooting_release_frames=217,
            shooting_follow_through_frames=61,
            shooting_setup_score=22.4,
            shooting_follow_through_score=65.7,
            pose_comparison=[
                {"key": "wrist_alignment", "match_rate": 9.1, "observed_frames": 209},
                {"key": "knee_bend_angle", "match_rate": 70.5, "observed_frames": 237},
                {"key": "body_balance", "match_rate": 31.4, "observed_frames": 255},
            ],
        )

        self.assertEqual(result.average_score, 80)
        self.assertEqual(result.classification, "Good")
        self.assertTrue(any("Set position was weak" in warning for warning in result.warnings))
        self.assertTrue(any("Elbow-wrist alignment was far" in warning for warning in result.warnings))

    def test_clean_reference_pose_can_still_score_near_perfect(self):
        result = apply_coaching_clip_validity(
            mode="shooting_form",
            average_score=96.5,
            best_score=100,
            worst_score=88,
            analyzed_frames=120,
            pose_frames=120,
            ball_frames=115,
            action_label="Shots",
            action_count=1,
            shooting_evidence_frames=80,
            shooting_setup_frames=25,
            shooting_release_frames=80,
            shooting_follow_through_frames=15,
            pose_comparison=[
                {"key": "wrist_alignment", "match_rate": 88.0, "observed_frames": 70},
                {"key": "knee_bend_angle", "match_rate": 82.0, "observed_frames": 120},
                {"key": "body_balance", "match_rate": 95.0, "observed_frames": 120},
            ],
        )

        self.assertEqual(result.average_score, 96.5)
        self.assertEqual(result.classification, "Excellent")
        self.assertEqual(result.warnings, [])

    def test_validity_warnings_take_priority_over_normal_feedback(self):
        feedback = merge_validity_warnings(
            ["No basketball detected. Keep the ball visible throughout the clip."],
            ["Strong overall movement quality detected.", "Keep your elbow aligned."],
        )

        self.assertEqual(feedback[0], "No basketball detected. Keep the ball visible throughout the clip.")
        self.assertNotIn("Strong overall movement quality detected.", feedback)

    def test_shot_training_warns_when_no_shot_attempt_is_detected(self):
        try:
            from backend.app.shot_training import _shot_training_validity_warning
        except ModuleNotFoundError as error:
            if error.name == "ultralytics":
                self.skipTest("ultralytics is not installed in this local environment")
            raise

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
