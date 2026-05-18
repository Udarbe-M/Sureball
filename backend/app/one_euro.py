from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional


def _smoothing_factor(delta_time: float, cutoff: float) -> float:
    if delta_time <= 0:
        return 1.0
    rate = 2.0 * math.pi * cutoff * delta_time
    return rate / (rate + 1.0)


@dataclass
class LowPassFilter:
    initialized: bool = False
    previous_value: float = 0.0

    def filter(self, value: float, alpha: float) -> float:
        if not self.initialized:
            self.initialized = True
            self.previous_value = value
            return value

        filtered_value = alpha * value + (1.0 - alpha) * self.previous_value
        self.previous_value = filtered_value
        return filtered_value


class OneEuroFilter:
    def __init__(
        self,
        *,
        min_cutoff: float = 1.0,
        beta: float = 0.02,
        derivative_cutoff: float = 1.0,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.derivative_cutoff = derivative_cutoff
        self.last_timestamp: Optional[float] = None
        self.value_filter = LowPassFilter()
        self.derivative_filter = LowPassFilter()
        self.last_raw_value: Optional[float] = None

    def filter(self, value: float, timestamp: float) -> float:
        if self.last_timestamp is None:
            self.last_timestamp = timestamp
            self.last_raw_value = value
            return self.value_filter.filter(value, 1.0)

        delta_time = max(timestamp - self.last_timestamp, 1e-6)
        raw_derivative = 0.0 if self.last_raw_value is None else (value - self.last_raw_value) / delta_time
        derivative_alpha = _smoothing_factor(delta_time, self.derivative_cutoff)
        filtered_derivative = self.derivative_filter.filter(raw_derivative, derivative_alpha)

        cutoff = self.min_cutoff + self.beta * abs(filtered_derivative)
        value_alpha = _smoothing_factor(delta_time, cutoff)
        filtered_value = self.value_filter.filter(value, value_alpha)

        self.last_timestamp = timestamp
        self.last_raw_value = value
        return filtered_value


class LandmarkSmoother:
    def __init__(
        self,
        *,
        min_cutoff: float = 1.0,
        beta: float = 0.02,
        derivative_cutoff: float = 1.0,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.derivative_cutoff = derivative_cutoff
        self.filters: Dict[tuple[int, str], OneEuroFilter] = {}

    def smooth(self, points: List[Dict[str, float]], timestamp: float) -> List[Dict[str, float]]:
        smoothed_points: List[Dict[str, float]] = []

        for index, point in enumerate(points):
            smoothed_point = dict(point)
            for axis in ("x", "y"):
                filter_key = (index, axis)
                if filter_key not in self.filters:
                    self.filters[filter_key] = OneEuroFilter(
                        min_cutoff=self.min_cutoff,
                        beta=self.beta,
                        derivative_cutoff=self.derivative_cutoff,
                    )
                smoothed_point[axis] = self.filters[filter_key].filter(float(point[axis]), timestamp)
            smoothed_points.append(smoothed_point)

        return smoothed_points
