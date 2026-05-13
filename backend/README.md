# SureBall FastAPI Backend

Prototype backend for:

**SureBall: Basketball Coaching Application Utilizing MediaPipe Pose and YOLOv11 for Pose Estimation via Mobile**

This backend accepts image frames or uploaded videos, runs pose estimation and basketball detection, extracts rule-based biomechanics, and returns coaching feedback with a score.

## Stack

- FastAPI
- OpenCV
- MediaPipe Pose / BlazePose
- Ultralytics YOLOv11
- NumPy
- Pydantic

## Folder Structure

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── pose_estimator.py
│   ├── ball_detector.py
│   ├── feedback_engine.py
│   ├── scoring.py
│   ├── schemas.py
│   └── utils.py
├── data/
│   └── .gitkeep
├── main.py
├── requirements.txt
└── README.md
```

## Installation

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Optional:
Place YOLO weights at `backend/models/yolo11n.pt`.

If no local weights are present, the code falls back to `"yolo11n.pt"`. On first run, Ultralytics may try to resolve that model automatically.

## Run

From the `backend/` folder:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### `GET /health`

Checks whether the backend is online and reports detector readiness.

Example response:

```json
{
  "status": "ok",
  "service": "sureball-backend",
  "pose_estimator": "ready",
  "ball_detector_ready": true,
  "ball_detector_model": "yolo11n.pt"
}
```

### `POST /analyze-frame`

Analyzes a single uploaded image frame.

Form-data fields:

- `mode`: `shooting_form`, `defensive_stance`, or `basic_footwork`
- `frame`: image file

Example response:

```json
{
  "session_id": "4ef8dcb8b0684e3f85a2a1a243ba9017",
  "mode": "shooting_form",
  "timestamp": "2026-05-13T09:22:51.244729+00:00",
  "frame_index": 0,
  "pose_detected": true,
  "ball_detected": true,
  "features": {
    "shoulder_angle": 43.8,
    "elbow_angle": 95.4,
    "wrist_alignment": 0.14,
    "knee_bend_angle": 132.9,
    "torso_alignment": 7.1,
    "feet_spacing": 1.03,
    "ball_to_wrist_distance": 0.22,
    "ball_release_position": 34.0,
    "body_balance": 0.08,
    "symmetry_score": 0.92
  },
  "feedback": [
    {
      "code": "solid_form",
      "message": "Strong rep. Maintain this posture and rhythm.",
      "severity": "low",
      "deduction": 0
    }
  ],
  "score": {
    "score": 100,
    "classification": "Excellent",
    "deductions": 0
  },
  "coaching_summary": "Shooting form evaluated with emphasis on elbow alignment, knee bend, ball control, and balance.",
  "ball_box": {
    "x1": 412.6,
    "y1": 217.2,
    "x2": 458.8,
    "y2": 262.9,
    "confidence": 0.83,
    "label": "basketball"
  },
  "landmarks": {},
  "annotated_frame_base64": "/9j/4AAQSkZJRgABAQ..."
}
```

### `POST /analyze-video`

Processes an uploaded video frame by frame using sampled analysis.

Form-data fields:

- `mode`: `shooting_form`, `defensive_stance`, or `basic_footwork`
- `video`: video file
- `sample_stride`: optional sampling interval, default `5`

Example response:

```json
{
  "session_id": "0d8a2c1e7f7a4ef5b0fe8b53f7c86d95",
  "mode": "defensive_stance",
  "timestamp": "2026-05-13T09:24:18.802918+00:00",
  "processed_frames": 120,
  "sampled_frames": 24,
  "average_score": 81.67,
  "best_score": 95,
  "worst_score": 64,
  "classification": "Good",
  "dominant_feedback": [
    "Widen your defensive stance.",
    "Sit lower and bend your knees more."
  ],
  "frame_results": [],
  "session_summary": "Defensive Stance session completed with an average score of 81.7. Focus areas: Widen your defensive stance., Sit lower and bend your knees more."
}
```

## Rule-Based Feedback Logic

The prototype uses simple coaching thresholds instead of a trained classifier.

- `shooting_form`
  - elbow alignment
  - knee bend
  - ball-to-hand control
  - release height
  - balance
- `defensive_stance`
  - feet spacing
  - knee bend
  - forward torso readiness
  - shoulder and hip level balance
- `basic_footwork`
  - base width
  - torso posture
  - ready knee bend
  - movement balance

## Session Storage

Session summaries are stored locally in:

`backend/data/session_history.json`

The file is created automatically on first run.
