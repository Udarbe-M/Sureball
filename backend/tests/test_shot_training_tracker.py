import unittest

from backend.app.shot_training import SHOT_TRAINING_CONFIDENCE_OVERRIDES, ShotTrainingTracker


def shot_detection():
    return [{"label": "player_shooting", "confidence": 0.9, "x1": 0, "y1": 0, "x2": 1, "y2": 1}]


def make_detection():
    return [{"label": "ball_in_basket", "confidence": 0.9, "x1": 0, "y1": 0, "x2": 1, "y2": 1}]


def basket_detection():
    return [{"label": "basket", "confidence": 0.9, "x1": 90, "y1": 90, "x2": 130, "y2": 120}]


def ball_detection(x1=104, y1=96, x2=118, y2=110):
    return [{"label": "ball", "confidence": 0.9, "x1": x1, "y1": y1, "x2": x2, "y2": y2}]


class ShotTrainingTrackerTests(unittest.TestCase):
    def test_shot_training_keeps_lower_ball_confidence_thresholds(self):
        self.assertNotIn("ball", SHOT_TRAINING_CONFIDENCE_OVERRIDES)
        self.assertLess(SHOT_TRAINING_CONFIDENCE_OVERRIDES["ball_in_basket"], 0.70)

    def test_continuous_shot_signal_does_not_create_ghost_second_attempt(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(70):
            detections = []
            if frame_index <= 65:
                detections.extend(shot_detection())
            if frame_index == 20:
                detections.extend(make_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_new_attempt_can_start_after_shot_signal_resets(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(120):
            detections = []
            if frame_index in {0, 1, 2, 3, 4, 5, 6, 7}:
                detections.extend(shot_detection())
            if frame_index == 20:
                detections.extend(make_detection())
            if frame_index in {60, 61, 62, 63, 64, 65}:
                detections.extend(shot_detection())
            if frame_index == 80:
                detections.extend(make_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 2, "makes": 2, "misses": 0, "accuracy": 100.0},
        )

    def test_ball_overlapping_basket_counts_as_make_without_ball_in_basket_label(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 15:
                detections.extend(basket_detection())
                detections.extend(ball_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_ball_near_last_known_basket_counts_as_make(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index == 0:
                detections.extend(basket_detection())
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 15:
                detections.extend(ball_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_ball_in_basket_counts_make_when_shooting_pose_label_is_missed(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(80):
            detections = []
            if 20 <= frame_index <= 35:
                detections.extend(make_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_inferred_make_without_shooting_pose_label_does_not_count(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index == 0:
                detections.extend(basket_detection())
            if frame_index == 10:
                detections.extend(ball_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
        )


if __name__ == "__main__":
    unittest.main()
