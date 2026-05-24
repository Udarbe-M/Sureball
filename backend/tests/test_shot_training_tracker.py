import unittest

from backend.app.shot_training import ShotTrainingTracker


def shot_detection():
    return [{"label": "player_shooting", "confidence": 0.9, "x1": 0, "y1": 0, "x2": 1, "y2": 1}]


def make_detection():
    return [{"label": "ball_in_basket", "confidence": 0.9, "x1": 0, "y1": 0, "x2": 1, "y2": 1}]


class ShotTrainingTrackerTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
