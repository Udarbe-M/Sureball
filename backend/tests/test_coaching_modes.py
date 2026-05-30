import unittest
from types import SimpleNamespace

import numpy as np

from backend.app.coaching_analysis import POSE_CONFIDENCE_THRESHOLD, run_coaching_analysis
from backend.app.coaching_video import (
    CoachingActionCounter,
    _draw_shooting_detection_boxes,
    _has_shooting_evidence,
    effective_coaching_sample_stride,
)
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

    def test_dribbling_uses_denser_video_sampling(self):
        self.assertEqual(effective_coaching_sample_stride("dribbling", 5), 2)
        self.assertEqual(effective_coaching_sample_stride("dribbling", 1), 1)
        self.assertEqual(effective_coaching_sample_stride("passing", 5), 5)

    def test_coaching_modes_keep_low_confidence_ball_detections(self):
        for mode in ("shooting_form", "dribbling", "passing"):
            with self.subTest(mode=mode):
                detector = _FakeBallDetector(confidence=0.31)

                result = _run_frame(mode=mode, ball_detector=detector, pose_visibility=POSE_CONFIDENCE_THRESHOLD)

                self.assertTrue(result.ball_detected)
                self.assertEqual(result.ball_box.confidence, 0.31)
                self.assertEqual(detector.min_confidences, [])

    def test_coaching_modes_ignore_body_pose_below_70_percent_confidence(self):
        for mode in ("shooting_form", "dribbling", "passing"):
            with self.subTest(mode=mode):
                result = _run_frame(
                    mode=mode,
                    ball_detector=_FakeBallDetector(confidence=0.31),
                    pose_visibility=POSE_CONFIDENCE_THRESHOLD - 0.01,
                )

                self.assertFalse(result.pose_detected)
                self.assertTrue(result.ball_detected)

    def test_coaching_modes_accept_body_pose_at_70_percent_confidence(self):
        for mode in ("shooting_form", "dribbling", "passing"):
            with self.subTest(mode=mode):
                result = _run_frame(
                    mode=mode,
                    ball_detector=_FakeBallDetector(confidence=0.31),
                    pose_visibility=POSE_CONFIDENCE_THRESHOLD,
                )

                self.assertTrue(result.pose_detected)

    def test_shooting_setup_evidence_only_requires_pose_and_ball_visible(self):
        response = SimpleNamespace(
            pose_detected=True,
            ball_detected=True,
            features=FeatureSet(ball_vertical_zone="low", ball_to_wrist_distance=1.4),
        )

        self.assertTrue(_has_shooting_evidence(response))

    def test_shooting_detection_overlay_draws_player_shooting_and_basket_boxes_only(self):
        frame = np.zeros((80, 120, 3), dtype=np.uint8)

        _draw_shooting_detection_boxes(
            frame,
            [
                {"label": "ball", "confidence": 0.9, "x1": 1, "y1": 1, "x2": 10, "y2": 10},
            ],
        )
        self.assertFalse(np.any(frame))

        _draw_shooting_detection_boxes(
            frame,
            [
                {
                    "label": "player_shooting",
                    "display_label": "Player Shooting",
                    "confidence": 0.82,
                    "x1": 15,
                    "y1": 18,
                    "x2": 55,
                    "y2": 70,
                },
                {
                    "label": "basket",
                    "display_label": "Basket",
                    "confidence": 0.74,
                    "x1": 70,
                    "y1": 10,
                    "x2": 105,
                    "y2": 35,
                },
            ],
        )

        self.assertTrue(np.any(frame))


class _FakeBallDetector:
    def __init__(self, confidence):
        self.confidence = confidence
        self.min_confidences = []

    def detect(self, frame, min_confidence=None):
        if min_confidence is not None:
            self.min_confidences.append(min_confidence)
        return {
            "x1": 118.0,
            "y1": 96.0,
            "x2": 138.0,
            "y2": 116.0,
            "confidence": self.confidence,
            "label": "basketball",
        }


class _FakePoseEstimator:
    def __init__(self, visibility):
        self.visibility = visibility

    def detect(self, frame, smoother=None, timestamp=None):
        return {
            "pose_detected": True,
            "landmarks": _landmarks(self.visibility),
            "raw_landmarks": None,
            "drawing_landmarks": None,
        }

    def draw(self, frame, raw_landmarks):
        return frame.copy()


def _run_frame(mode, ball_detector, pose_visibility):
    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    return run_coaching_analysis(
        frame,
        mode=mode,
        session_id="test-session",
        frame_index=0,
        pose_estimator=_FakePoseEstimator(pose_visibility),
        ball_detector=ball_detector,
        include_base64=False,
    )["response"]


def _landmarks(visibility):
    return {
        "nose": {"x": 160.0, "y": 52.0, "visibility": visibility},
        "left_shoulder": {"x": 125.0, "y": 88.0, "visibility": visibility},
        "right_shoulder": {"x": 195.0, "y": 88.0, "visibility": visibility},
        "left_elbow": {"x": 118.0, "y": 126.0, "visibility": visibility},
        "right_elbow": {"x": 202.0, "y": 126.0, "visibility": visibility},
        "left_wrist": {"x": 122.0, "y": 104.0, "visibility": visibility},
        "right_wrist": {"x": 198.0, "y": 104.0, "visibility": visibility},
        "left_hip": {"x": 132.0, "y": 158.0, "visibility": visibility},
        "right_hip": {"x": 188.0, "y": 158.0, "visibility": visibility},
        "left_knee": {"x": 132.0, "y": 198.0, "visibility": visibility},
        "right_knee": {"x": 188.0, "y": 198.0, "visibility": visibility},
        "left_ankle": {"x": 132.0, "y": 232.0, "visibility": visibility},
        "right_ankle": {"x": 188.0, "y": 232.0, "visibility": visibility},
    }


def _response(frame_index, features, ball_detected=True):
    return SimpleNamespace(frame_index=frame_index, features=features, ball_detected=ball_detected)


if __name__ == "__main__":
    unittest.main()
