import unittest

from backend.app.pose_comparison import PoseComparisonAggregator
from backend.app.schemas import FeatureSet


class PoseComparisonAggregatorTests(unittest.TestCase):
    def test_shooting_comparison_reports_actual_reference_and_match_rate(self):
        aggregator = PoseComparisonAggregator("shooting_form")
        aggregator.observe(
            FeatureSet(
                wrist_alignment=0.20,
                knee_bend_angle=140,
                ball_to_wrist_distance=0.35,
                body_balance=0.18,
            )
        )
        aggregator.observe(
            FeatureSet(
                wrist_alignment=0.30,
                knee_bend_angle=160,
                ball_to_wrist_distance=0.50,
                body_balance=0.30,
            )
        )

        result = {item["key"]: item for item in aggregator.build()}

        self.assertEqual(result["wrist_alignment"]["actual_value"], 0.25)
        self.assertEqual(result["wrist_alignment"]["match_rate"], 50.0)
        self.assertEqual(result["wrist_alignment"]["status"], "close")
        self.assertIn("0.28 or less", result["wrist_alignment"]["reference_display"])

    def test_passing_comparison_marks_arm_extension_as_matched(self):
        aggregator = PoseComparisonAggregator("passing")
        aggregator.observe(FeatureSet(elbow_angle=90, wrist_alignment=0.20, ball_to_wrist_distance=0.40, body_balance=0.10))
        aggregator.observe(FeatureSet(elbow_angle=100, wrist_alignment=0.25, ball_to_wrist_distance=0.45, body_balance=0.15))

        result = {item["key"]: item for item in aggregator.build()}

        self.assertEqual(result["elbow_angle"]["status"], "matched")
        self.assertEqual(result["elbow_angle"]["match_rate"], 100.0)
        self.assertEqual(result["elbow_angle"]["actual_display"], "95.0 degrees")

    def test_missing_measurement_is_reported_as_insufficient(self):
        comparison = PoseComparisonAggregator("dribbling").build()

        self.assertTrue(all(item["status"] == "insufficient" for item in comparison))
        self.assertTrue(all(item["actual_display"] == "Not detected" for item in comparison))


if __name__ == "__main__":
    unittest.main()
