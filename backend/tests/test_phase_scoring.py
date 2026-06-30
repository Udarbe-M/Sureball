import unittest

from backend.app.phase_scoring import PhaseScoreAggregator
from backend.app.schemas import FeatureSet, FrameAnalysisResponse, ScoreResult
from backend.app.utils import now_utc


def response_for(mode, *, frame_index, score, features, pose_detected=True, ball_detected=True):
    return FrameAnalysisResponse(
        session_id="test-session",
        mode=mode,
        timestamp=now_utc(),
        frame_index=frame_index,
        pose_detected=pose_detected,
        ball_detected=ball_detected,
        features=features,
        feedback=[],
        score=ScoreResult(score=score, classification="Good", deductions=100 - score),
        coaching_summary="Test frame",
    )


class PhaseScoreAggregatorTests(unittest.TestCase):
    def test_shooting_phase_average_uses_observed_key_phases(self):
        aggregator = PhaseScoreAggregator("shooting_form")
        aggregator.observe(
            response_for(
                "shooting_form",
                frame_index=0,
                score=82,
                features=FeatureSet(ball_vertical_zone="torso", ball_to_wrist_distance=0.40),
            )
        )
        aggregator.observe(
            response_for(
                "shooting_form",
                frame_index=5,
                score=90,
                features=FeatureSet(ball_vertical_zone="high", ball_release_position=8),
            )
        )
        aggregator.observe(
            response_for(
                "shooting_form",
                frame_index=10,
                score=70,
                features=FeatureSet(body_balance=0.18),
                ball_detected=False,
            )
        )

        phases = {item["key"]: item for item in aggregator.build()}

        self.assertEqual(phases["set_position"]["frame_count"], 1)
        self.assertEqual(phases["release"]["average_score"], 90.0)
        self.assertEqual(phases["follow_through"]["frame_count"], 1)
        self.assertEqual(aggregator.phase_average(84.25), 84.25)

    def test_phase_average_returns_original_frame_average(self):
        aggregator = PhaseScoreAggregator("shooting_form")
        aggregator.observe(
            response_for(
                "shooting_form",
                frame_index=0,
                score=62,
                features=FeatureSet(ball_vertical_zone="torso", ball_to_wrist_distance=0.40),
            )
        )
        aggregator.observe(
            response_for(
                "shooting_form",
                frame_index=5,
                score=72,
                features=FeatureSet(ball_vertical_zone="high", ball_release_position=8),
            )
        )

        self.assertEqual(aggregator.phase_average(84.25), 84.25)

    def test_dribbling_tracks_ready_control_and_rhythm_phases(self):
        aggregator = PhaseScoreAggregator("dribbling")
        aggregator.observe(
            response_for(
                "dribbling",
                frame_index=0,
                score=75,
                features=FeatureSet(knee_bend_angle=145, ball_vertical_zone="torso"),
            )
        )
        aggregator.observe(
            response_for(
                "dribbling",
                frame_index=2,
                score=88,
                features=FeatureSet(ball_vertical_zone="low", ball_to_wrist_distance=0.42),
            )
        )
        aggregator.observe(
            response_for(
                "dribbling",
                frame_index=4,
                score=64,
                features=FeatureSet(ball_vertical_zone="high", ball_to_wrist_distance=0.92),
            )
        )

        phases = {item["key"]: item for item in aggregator.build()}

        self.assertEqual(phases["ready_stance"]["frame_count"], 1)
        self.assertEqual(phases["ball_control"]["frame_count"], 1)
        self.assertEqual(phases["bounce_rhythm"]["frame_count"], 1)


if __name__ == "__main__":
    unittest.main()
