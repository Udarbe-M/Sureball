from __future__ import annotations

from typing import Dict, Optional

import cv2
import mediapipe as mp
import numpy as np

from .utils import filter_landmarks, normalize_point


class PoseEstimator:
    def __init__(
        self,
        static_image_mode: bool = False,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        self.mp_pose = mp.solutions.pose
        self.mp_drawing = mp.solutions.drawing_utils
        self.pose = self.mp_pose.Pose(
            static_image_mode=static_image_mode,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
            model_complexity=1,
        )

    def detect(self, frame: np.ndarray) -> Dict[str, object]:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self.pose.process(rgb_frame)

        if not result.pose_landmarks:
            return {
                "pose_detected": False,
                "landmarks": {},
                "raw_landmarks": None,
            }

        height, width = frame.shape[:2]
        raw_landmarks = [
            normalize_point(
                landmark.x,
                landmark.y,
                width=width,
                height=height,
                visibility=landmark.visibility,
            )
            for landmark in result.pose_landmarks.landmark
        ]

        return {
            "pose_detected": True,
            "landmarks": filter_landmarks(raw_landmarks),
            "raw_landmarks": result.pose_landmarks,
        }

    def draw(self, frame: np.ndarray, raw_landmarks: Optional[object]) -> np.ndarray:
        if raw_landmarks is None:
            return frame

        annotated = frame.copy()
        self.mp_drawing.draw_landmarks(
            annotated,
            raw_landmarks,
            self.mp_pose.POSE_CONNECTIONS,
            landmark_drawing_spec=self.mp_drawing.DrawingSpec(color=(0, 255, 180), thickness=2, circle_radius=3),
            connection_drawing_spec=self.mp_drawing.DrawingSpec(color=(40, 220, 40), thickness=2),
        )
        return annotated
