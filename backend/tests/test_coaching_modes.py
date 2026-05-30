import unittest
from types import SimpleNamespace

from backend.app.coaching_video import CoachingActionCounter
from backend.app.feedback_engine import generate_feedback
from backend.app.schemas import FeatureSet


class CoachingModeFeedbackTests(unittest.TestCase):
    def test_dribbling_uses_ball_tracking_feedback(self):
        features = FeatureSet(
            knee_bend_angle=166,
            ball_to_wrist_distance=0.7,
            ball_vertical_zone="high",
            ball_body_offset=1.3,
            body_balance=0.12,
        )

        feedback, summary = generate_feedback("dribbling", features, ball_detected=True)
        codes = {item.code for item in feedback}

        self.assertIn("dribbling_ball_connection", codes)
        self.assertIn("dribbling_ball_height", codes)
        self.assertIn("YOLOv11", summary)
        self.assertIn("MediaPipe", summary)

    def test_passing_uses_ball_tracking_feedback(self):
        features = FeatureSet(
            elbow_angle=70,
            wrist_alignment=0.4,
            ball_to_wrist_distance=0.6,
            ball_vertical_zone="low",
            ball_body_offset=1.4,
            body_balance=0.12,
        )

        feedback, summary = generate_feedback("passing", features, ball_detected=True)
        codes = {item.code for item in feedback}

        self.assertIn("passing_ball_connection", codes)
        self.assertIn("passing_ball_window", codes)
        self.assertIn("YOLOv11", summary)
        self.assertIn("MediaPipe", summary)

    def test_dribbling_counter_counts_low_controlled_contacts(self):
        counter = CoachingActionCounter("dribbling", fps=30)

        counter.observe(_response(0, FeatureSet(ball_vertical_zone="torso", ball_to_wrist_distance=0.4)))
        counter.observe(_response(5, FeatureSet(ball_vertical_zone="low", ball_to_wrist_distance=0.4)))
        counter.observe(_response(10, FeatureSet(ball_vertical_zone="low", ball_to_wrist_distance=0.4)))
        counter.observe(_response(15, FeatureSet(ball_vertical_zone="torso", ball_to_wrist_distance=0.4)))
        counter.observe(_response(22, FeatureSet(ball_vertical_zone="low", ball_to_wrist_distance=0.4)))

        self.assertEqual(counter.count, 2)

    def test_passing_counter_counts_releases_from_control(self):
        counter = CoachingActionCounter("passing", fps=30)

        counter.observe(_response(0, FeatureSet(ball_to_wrist_distance=0.3, ball_body_offset=0.5)))
        counter.observe(_response(8, FeatureSet(ball_to_wrist_distance=0.92, ball_body_offset=1.3)))
        counter.observe(_response(12, FeatureSet(ball_to_wrist_distance=0.95, ball_body_offset=1.4)))
        counter.observe(_response(20, FeatureSet(ball_to_wrist_distance=0.3, ball_body_offset=0.5)))
        counter.observe(_response(30, FeatureSet(ball_to_wrist_distance=0.92, ball_body_offset=1.3)))

        self.assertEqual(counter.count, 2)

def _response(frame_index, features, ball_detected=True):
    return SimpleNamespace(frame_index=frame_index, features=features, ball_detected=ball_detected)


if __name__ == "__main__":
    unittest.main()
