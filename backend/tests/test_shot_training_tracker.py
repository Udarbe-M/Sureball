import unittest

import numpy as np

from backend.app.shot_training import SHOT_TRAINING_CONFIDENCE_OVERRIDES, ShotTrainingTracker, _apply_orientation_correction


def shot_detection():
    return [{"label": "player_shooting", "confidence": 0.9, "x1": 0, "y1": 0, "x2": 1, "y2": 1}]


def basket_detection():
    return [{"label": "basket", "confidence": 0.9, "x1": 90, "y1": 90, "x2": 130, "y2": 120}]


def ball_detection(x1=104, y1=96, x2=118, y2=110):
    return [{"label": "ball", "confidence": 0.9, "x1": x1, "y1": y1, "x2": x2, "y2": y2}]


def ball_above_rim_detection():
    return ball_detection(102, 76, 118, 92)


def ball_entering_rim_detection():
    return ball_detection(102, 92, 118, 108)


def ball_under_basket_detection():
    return ball_detection(102, 124, 118, 140)


def direct_make_in_rim_detection():
    return [{"label": "ball_in_basket", "confidence": 0.9, "x1": 102, "y1": 92, "x2": 118, "y2": 108}]


def make_detection():
    return basket_detection() + direct_make_in_rim_detection()


def ball_overlapping_basket_core_detection():
    return ball_detection(104, 94, 126, 116)


def release_detection():
    return basket_detection() + ball_above_rim_detection()


class ShotTrainingTrackerTests(unittest.TestCase):
    def test_explicit_landscape_orientation_preserves_landscape_output(self):
        auto_rotated_portrait_frame = np.zeros((1280, 720, 3), dtype=np.uint8)

        corrected = _apply_orientation_correction(
            auto_rotated_portrait_frame,
            90,
            auto_orientation_enabled=True,
            encoded_frame_size=(1280, 720),
            source_orientation="landscape",
        )

        self.assertGreaterEqual(corrected.shape[1], corrected.shape[0])

    def test_explicit_portrait_orientation_preserves_portrait_output(self):
        raw_landscape_frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        corrected = _apply_orientation_correction(
            raw_landscape_frame,
            90,
            auto_orientation_enabled=False,
            encoded_frame_size=(1280, 720),
            source_orientation="portrait",
        )

        self.assertGreaterEqual(corrected.shape[0], corrected.shape[1])

    def test_shot_training_keeps_lower_ball_confidence_thresholds(self):
        self.assertNotIn("ball", SHOT_TRAINING_CONFIDENCE_OVERRIDES)
        self.assertLess(SHOT_TRAINING_CONFIDENCE_OVERRIDES["ball_in_basket"], 0.70)

    def test_continuous_shot_signal_does_not_create_ghost_second_attempt(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(70):
            detections = []
            if frame_index <= 65:
                detections.extend(shot_detection())
            if frame_index in {0, 10, 11, 12}:
                detections.extend(basket_detection())
            if frame_index == 10:
                detections.extend(ball_above_rim_detection())
            if frame_index == 11:
                detections.extend(ball_entering_rim_detection())
            if frame_index == 12:
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )
        self.assertEqual(len(tracker.to_shot_events()), 1)
        self.assertEqual(tracker.to_shot_events()[0]["result"], "make")

    def test_new_attempt_can_start_after_shot_signal_resets(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index in {0, 1, 2, 3, 4, 5, 6, 7}:
                detections.extend(shot_detection())
            if frame_index in {0, 20, 21, 22, 60, 80, 81, 82}:
                detections.extend(basket_detection())
            if frame_index == 20:
                detections.extend(ball_above_rim_detection())
            if frame_index == 21:
                detections.extend(ball_entering_rim_detection())
            if frame_index == 22:
                detections.extend(ball_under_basket_detection())
            if frame_index in {60, 61, 62, 63, 64, 65}:
                detections.extend(shot_detection())
            if frame_index == 80:
                detections.extend(ball_above_rim_detection())
            if frame_index == 81:
                detections.extend(ball_entering_rim_detection())
            if frame_index == 82:
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 2, "makes": 2, "misses": 0, "accuracy": 100.0},
        )

    def test_immediate_post_direct_make_shot_label_does_not_create_duplicate_attempt(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index <= 7 or 16 <= frame_index <= 20:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index in {12, 13}:
                detections.extend(basket_detection())
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 14:
                detections.extend(basket_detection())
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )
        self.assertEqual(len(tracker.to_shot_events()), 1)
        self.assertEqual(tracker.to_shot_events()[0]["result"], "make")

    def test_single_frame_ball_overlap_does_not_count_as_make(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index == 15:
                detections.extend(basket_detection())
                detections.extend(ball_entering_rim_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )
        event = tracker.to_shot_events()[0]
        self.assertEqual(event["result"], "miss")
        self.assertEqual(event["result_quality"], "low")
        self.assertIn("no confirmed ball-through-hoop result", event["evidence"])
        self.assertIn("Counted as a miss", event["result_reason"])

    def test_setup_pose_clusters_before_release_do_not_start_attempts(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if 10 <= frame_index <= 20 or 70 <= frame_index <= 80:
                detections.extend(shot_detection())
                detections.extend(basket_detection())
                detections.extend(ball_detection(104, 126, 118, 140))
            if 120 <= frame_index <= 126:
                detections.extend(shot_detection())
            if frame_index == 127:
                detections.extend(release_detection())
            if frame_index in {150, 151, 152}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_rim_bounce_without_under_basket_counts_as_miss(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index in {20, 21, 22}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_ball_above_then_entering_rim_and_under_counts_as_make(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index in {0, 10, 11, 12}:
                detections.extend(basket_detection())
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 15:
                detections.extend(ball_detection(30, 30, 46, 46))
            if frame_index == 10:
                detections.extend(ball_above_rim_detection())
            if frame_index == 11:
                detections.extend(ball_entering_rim_detection())
            if frame_index == 12:
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )
        event = tracker.to_shot_events()[0]
        self.assertEqual(event["result_quality"], "high")
        self.assertIn("recent ball path under basket", event["evidence"])
        self.assertIn("tracked below the basket", event["result_reason"])

    def test_ball_under_basket_without_rim_entry_does_not_count(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index == 15:
                detections.extend(basket_detection())
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_ball_in_basket_counts_make_when_shooting_pose_label_is_missed(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(80):
            detections = []
            if frame_index in {18, 19, 20}:
                detections.extend(basket_detection())
            if frame_index == 18:
                detections.extend(ball_above_rim_detection())
            if 19 <= frame_index <= 20:
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 21:
                detections.extend(basket_detection())
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_single_frame_low_confidence_direct_make_without_entry_path_does_not_count(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index == 12:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
                detections.append(
                    {
                        "label": "ball_in_basket",
                        "confidence": 0.30,
                        "x1": 102,
                        "y1": 92,
                        "x2": 126,
                        "y2": 116,
                    }
                )
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
        )

    def test_confirmed_ball_in_basket_without_under_basket_counts_as_miss(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index in {12, 13}:
                detections.extend(basket_detection())
                detections.extend(direct_make_in_rim_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_single_ball_in_basket_plus_under_basket_counts_as_make(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 11:
                detections.extend(basket_detection())
                detections.extend(ball_above_rim_detection())
            if frame_index in {12, 13}:
                detections.extend(basket_detection())
            if frame_index in {12, 13}:
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 13:
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_single_ball_in_basket_flash_without_entering_counts_as_miss(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index == 12:
                detections.extend(basket_detection())
                detections.extend(direct_make_in_rim_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_repeated_ball_overlap_with_basket_core_without_pass_counts_as_miss(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index in {12, 13, 14, 15}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_repeated_ball_overlap_without_shooting_pose_does_not_count(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index in {12, 13, 14, 15}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
        )

    def test_hoop_only_rim_pass_without_direct_make_or_shot_signal_does_not_count(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index in {10, 11, 12}:
                detections.extend(basket_detection())
            if frame_index == 10:
                detections.extend(ball_above_rim_detection())
            if frame_index == 11:
                detections.extend(ball_entering_rim_detection())
            if frame_index == 12:
                detections.extend(ball_under_basket_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
        )

    def test_late_shooting_label_after_hoop_only_make_does_not_duplicate_attempt(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(80):
            detections = []
            if frame_index == 11:
                detections.extend(basket_detection())
                detections.extend(ball_above_rim_detection())
            if frame_index in {12, 13}:
                detections.extend(basket_detection())
            if frame_index in {12, 13}:
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 14:
                detections.extend(basket_detection())
                detections.extend(ball_under_basket_detection())
            if 48 <= frame_index <= 54:
                detections.extend(shot_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_rebound_back_to_hoop_after_make_does_not_count_as_second_shot(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(120):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index in {12, 13}:
                detections.extend(basket_detection())
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 14:
                detections.extend(basket_detection())
                detections.extend(ball_under_basket_detection())
            if frame_index in {61, 62, 63, 64}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )
        self.assertEqual(len(tracker.to_shot_events()), 1)

    def test_single_ball_overlap_with_basket_core_does_not_count_as_make(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index == 12:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_delayed_shooting_label_uses_recent_confirmed_hoop_only_make(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(80):
            detections = []
            if frame_index == 9:
                detections.extend(basket_detection())
                detections.extend(ball_above_rim_detection())
            if frame_index in {10, 11}:
                detections.extend(basket_detection())
            if frame_index in {10, 11}:
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 11:
                detections.extend(ball_under_basket_detection())
            if frame_index in {39, 40}:
                detections.extend(shot_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 1, "misses": 0, "accuracy": 100.0},
        )

    def test_stale_hoop_only_make_does_not_attach_to_later_shooting_label(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(220):
            detections = []
            if frame_index == 9:
                detections.extend(basket_detection())
                detections.extend(ball_above_rim_detection())
            if frame_index in {10, 11}:
                detections.extend(basket_detection())
            if frame_index in {10, 11}:
                detections.extend(direct_make_in_rim_detection())
            if frame_index == 11:
                detections.extend(ball_under_basket_detection())
            if frame_index in {80, 81}:
                detections.extend(shot_detection())
            if frame_index == 82:
                detections.extend(release_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 2, "makes": 1, "misses": 1, "accuracy": 50.0},
        )

    def test_late_make_after_new_shot_keeps_new_attempt_pending(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(140):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if 92 <= frame_index <= 96:
                detections.extend(shot_detection())
            if frame_index in {120, 121, 122, 123}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)
        tracker.finalize_pending_attempt(140)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 2, "makes": 0, "misses": 2, "accuracy": 0.0},
        )

    def test_late_rim_overlap_without_clear_pass_stays_miss(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(140):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if frame_index in {110, 111, 112, 113}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )
        self.assertEqual(len(tracker.to_shot_events()), 1)
        self.assertEqual(tracker.to_shot_events()[0]["result"], "miss")

    def test_new_shot_cluster_without_clear_make_keeps_both_as_misses(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(100):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            if 50 <= frame_index <= 54:
                detections.extend(shot_detection())
            if frame_index in {70, 71, 72, 73}:
                detections.extend(basket_detection())
                detections.extend(ball_overlapping_basket_core_detection())
            tracker.observe(detections, frame_index)
        tracker.finalize_pending_attempt(140)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 2, "makes": 0, "misses": 2, "accuracy": 0.0},
        )

    def test_pending_attempt_can_be_discarded_at_end_of_clip(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(20):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            tracker.observe(detections, frame_index)
        tracker.discard_pending_attempt()

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
        )
        self.assertEqual(tracker.to_shot_events(), [])

    def test_late_pending_attempt_is_kept_as_miss_at_end_of_clip(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(20):
            detections = []
            if frame_index <= 7:
                detections.extend(shot_detection())
            if frame_index == 8:
                detections.extend(release_detection())
            tracker.observe(detections, frame_index)
        tracker.finalize_pending_attempt(40)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 1, "makes": 0, "misses": 1, "accuracy": 0.0},
        )

    def test_inferred_make_without_shooting_pose_label_does_not_count(self):
        tracker = ShotTrainingTracker(30)

        for frame_index in range(40):
            detections = []
            if frame_index == 0:
                detections.extend(basket_detection())
            if frame_index == 10:
                detections.extend(ball_entering_rim_detection())
            tracker.observe(detections, frame_index)

        self.assertEqual(
            tracker.to_stats(),
            {"attempts": 0, "makes": 0, "misses": 0, "accuracy": 0.0},
        )


if __name__ == "__main__":
    unittest.main()
