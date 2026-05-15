# SureBall Detector Training

This folder contains the local training flow for the multi-class basketball detector used by SureBall.

## Dataset

The current setup expects the Roboflow YOLOv5 PyTorch export:

- `C:\Users\Administrator\Documents\Sureball\Basketball detection.v1i.yolov5pytorch.zip`

During setup, the script extracts the dataset to:

- `backend/data/datasets/basketball_detection_v1/`

It also rewrites the dataset YAML so the trained model carries the intended class names:

1. `Ball`
2. `Ball in Basket`
3. `Player`
4. `Basket`
5. `Player Shooting`

## Training Command

Run from the repo root:

```bash
python backend/training/train_basketball_detector.py
```

This trains with:

- `YOLOv11s`
- `300` epochs
- `640x640` image size
- `AdamW`
- `lr0=0.001`
- cosine learning-rate decay
- auto batch sizing for the available VRAM

## Outputs

- Training runs: `backend/training/runs/`
- Extracted dataset: `backend/data/datasets/`
- Exported model for the app: `backend/models/basketball_detection_yolo11s.pt`

The backend detector now prefers `backend/models/basketball_detection_yolo11s.pt` automatically when it exists. If you want to point the backend to a different file, set `BALL_DETECTOR_MODEL`.
