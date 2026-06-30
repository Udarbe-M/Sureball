import unittest

from backend.app.feedback_engine import generate_feedback
from backend.app.coaching_analysis import _cap_invalid_frame_score
from backend.app.schemas import FeatureSet, ScoreResult
from backend.app.scoring import calculate_score


def feedback_codes(mode, features, ball_detected=True):
    feedback, _summary = generate_feedback(mode, features, ball_detected)
    return [cue.code for cue in feedback], feedback


class TutorialReferenceFeedbackTests(unittest.TestCase):
    def test_shooting_setup_from_tutorial_is_not_penalized_as_low_release(self):
        codes, feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=142,
                ball_to_wrist_distance=0.32,
                ball_release_position=-42,
                ball_vertical_zone="torso",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_shooting_release_window_still_checks_release_height(self):
        codes, _feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=172,
                ball_to_wrist_distance=0.32,
                ball_release_position=-8,
                ball_vertical_zone="high",
                body_balance=0.10,
            ),
        )

        self.assertIn("shooting_release_height", codes)
        self.assertNotIn("shooting_knee_bend", codes)

    def test_shooting_clean_release_allows_ball_to_separate_from_hand(self):
        codes, feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=172,
                ball_to_wrist_distance=0.70,
                ball_release_position=18,
                ball_vertical_zone="high",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_shooting_score_ignores_unreliable_ball_to_wrist_distance(self):
        codes, feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=142,
                ball_to_wrist_distance=2.00,
                ball_vertical_zone="torso",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_shooting_missing_ball_does_not_reduce_body_form_score(self):
        codes, feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=150,
                body_balance=0.10,
            ),
            ball_detected=False,
        )

        self.assertEqual(codes, ["ball_not_detected"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_shooting_frame_score_is_capped_below_excellent_when_ball_is_missing(self):
        score = _cap_invalid_frame_score(
            ScoreResult(score=92, classification="Excellent", deductions=8),
            mode="shooting_form",
            pose_detected=True,
            ball_detected=False,
        )

        self.assertEqual(score.score, 82)
        self.assertEqual(score.classification, "Good")

    def test_shooting_knee_load_is_forgiving_for_upright_players(self):
        codes, feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=160,
                ball_vertical_zone="torso",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_shooting_knee_load_only_minor_when_very_upright(self):
        codes, feedback = feedback_codes(
            "shooting_form",
            FeatureSet(
                wrist_alignment=0.18,
                knee_bend_angle=170,
                ball_vertical_zone="torso",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["shooting_knee_bend"])
        self.assertEqual(calculate_score(feedback).score, 96)

    def test_passing_load_or_bounce_pass_reference_is_not_penalized_for_bent_arms_or_low_ball(self):
        codes, feedback = feedback_codes(
            "passing",
            FeatureSet(
                elbow_angle=55,
                wrist_alignment=0.20,
                ball_to_wrist_distance=0.30,
                ball_body_offset=0.40,
                ball_vertical_zone="low",
                body_balance=0.08,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_dribbling_low_bounce_reference_allows_ball_to_drop_from_hand(self):
        codes, feedback = feedback_codes(
            "dribbling",
            FeatureSet(
                knee_bend_angle=145,
                ball_to_wrist_distance=0.78,
                ball_body_offset=0.70,
                ball_vertical_zone="low",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_dribbling_score_ignores_unreliable_ball_to_wrist_distance(self):
        codes, feedback = feedback_codes(
            "dribbling",
            FeatureSet(
                knee_bend_angle=145,
                ball_to_wrist_distance=2.00,
                ball_body_offset=0.70,
                ball_vertical_zone="low",
                body_balance=0.10,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_passing_release_window_still_requires_extension(self):
        codes, _feedback = feedback_codes(
            "passing",
            FeatureSet(
                elbow_angle=62,
                wrist_alignment=0.20,
                ball_to_wrist_distance=0.82,
                ball_body_offset=1.00,
                body_balance=0.08,
            ),
        )

        self.assertIn("passing_elbow_extension", codes)

    def test_passing_clean_release_allows_ball_to_separate_from_hands(self):
        codes, feedback = feedback_codes(
            "passing",
            FeatureSet(
                elbow_angle=102,
                wrist_alignment=0.20,
                ball_to_wrist_distance=0.82,
                ball_body_offset=1.00,
                body_balance=0.08,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)

    def test_passing_score_ignores_unreliable_ball_to_wrist_distance(self):
        codes, feedback = feedback_codes(
            "passing",
            FeatureSet(
                elbow_angle=55,
                wrist_alignment=0.20,
                ball_to_wrist_distance=2.00,
                ball_body_offset=0.40,
                ball_vertical_zone="torso",
                body_balance=0.08,
            ),
        )

        self.assertEqual(codes, ["solid_form"])
        self.assertEqual(calculate_score(feedback).score, 100)


if __name__ == "__main__":
    unittest.main()
