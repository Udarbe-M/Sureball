from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Sequence

import torch
from ultralytics import YOLO

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path(__file__).resolve().parents[1]
DATASETS_DIR = BACKEND_DIR / "data" / "datasets"
RUNS_DIR = Path(__file__).resolve().parent / "runs"
MODELS_DIR = BACKEND_DIR / "models"
DEFAULT_ZIP = REPO_ROOT / "Basketball detection.v1i.yolov5pytorch.zip"
DEFAULT_MODEL_NAME = "basketball_detection_yolo11s.pt"
CLASS_NAMES = [
    "Ball",
    "Ball in Basket",
    "Player",
    "Basket",
    "Player Shooting",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the SureBall multi-class basketball detector with YOLOv11s.")
    parser.add_argument("--zip", type=Path, default=DEFAULT_ZIP, help="Path to the Roboflow YOLOv5 PyTorch zip export.")
    parser.add_argument(
        "--dataset-name",
        default="basketball_detection_v1",
        help="Directory name to use under backend/data/datasets for the extracted dataset.",
    )
    parser.add_argument("--epochs", type=int, default=300, help="Number of training epochs.")
    parser.add_argument("--imgsz", type=int, default=640, help="Training image size.")
    parser.add_argument(
        "--batch",
        default="auto",
        help='Batch size override. Use "auto" to let Ultralytics fit the batch to the available VRAM.',
    )
    parser.add_argument("--lr0", type=float, default=0.001, help="Initial learning rate.")
    parser.add_argument("--optimizer", default="AdamW", help="Optimizer name passed to Ultralytics.")
    parser.add_argument("--model", default="yolo11s.pt", help="Base checkpoint to fine-tune.")
    parser.add_argument(
        "--run-name",
        default=f"basketball_detection_yolo11s_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        help="Run directory name under backend/training/runs.",
    )
    parser.add_argument(
        "--export-name",
        default=DEFAULT_MODEL_NAME,
        help="Filename to copy the trained best.pt to under backend/models.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=max(2, min(8, (os.cpu_count() or 4) // 2)),
        help="Dataloader worker count.",
    )
    parser.add_argument("--device", default="0" if torch.cuda.is_available() else "cpu", help="Training device.")
    parser.add_argument("--force-extract", action="store_true", help="Re-extract the dataset even if files already exist.")
    return parser.parse_args()


def sanitize_name(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return normalized.strip("._-") or "dataset"


def resolve_batch(batch_value: str) -> int:
    if str(batch_value).strip().lower() == "auto":
        return -1
    batch = int(batch_value)
    if batch <= 0:
        raise ValueError("Batch size must be a positive integer or 'auto'.")
    return batch


def extract_dataset(zip_path: Path, dataset_dir: Path, force_extract: bool) -> None:
    marker = dataset_dir / ".extracted_from_zip"
    if force_extract and dataset_dir.exists():
        shutil.rmtree(dataset_dir)
    if marker.exists():
        return

    dataset_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(dataset_dir)

    marker.write_text(
        json.dumps(
            {
                "source_zip": str(zip_path),
                "extracted_at": datetime.now().isoformat(timespec="seconds"),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def count_files(directory: Path) -> int:
    if not directory.exists():
        return 0
    return sum(1 for item in directory.iterdir() if item.is_file())


def write_dataset_yaml(dataset_dir: Path, class_names: Sequence[str]) -> Path:
    yaml_path = dataset_dir / "sureball.data.yaml"
    lines = [
        "train: train/images",
        "val: valid/images",
        "test: test/images",
        "",
        f"nc: {len(class_names)}",
        "names:",
    ]
    lines.extend(f"  {index}: {name}" for index, name in enumerate(class_names))
    yaml_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return yaml_path


def write_manifest(
    manifest_path: Path,
    zip_path: Path,
    dataset_dir: Path,
    dataset_yaml: Path,
    batch: int,
    args: argparse.Namespace,
) -> None:
    manifest = {
        "source_zip": str(zip_path),
        "dataset_dir": str(dataset_dir),
        "dataset_yaml": str(dataset_yaml),
        "classes": CLASS_NAMES,
        "counts": {
            "train_images": count_files(dataset_dir / "train" / "images"),
            "valid_images": count_files(dataset_dir / "valid" / "images"),
            "test_images": count_files(dataset_dir / "test" / "images"),
            "train_labels": count_files(dataset_dir / "train" / "labels"),
            "valid_labels": count_files(dataset_dir / "valid" / "labels"),
            "test_labels": count_files(dataset_dir / "test" / "labels"),
        },
        "training": {
            "model": args.model,
            "epochs": args.epochs,
            "imgsz": args.imgsz,
            "batch": batch,
            "optimizer": args.optimizer,
            "lr0": args.lr0,
            "cos_lr": True,
            "workers": args.workers,
            "device": args.device,
            "run_name": args.run_name,
            "export_name": args.export_name,
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def copy_best_weights(run_dir: Path, export_name: str) -> Path | None:
    best_weights = run_dir / "weights" / "best.pt"
    if not best_weights.exists():
        return None
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    destination = MODELS_DIR / export_name
    shutil.copy2(best_weights, destination)
    return destination


def main() -> None:
    args = parse_args()
    zip_path = args.zip.resolve()
    if not zip_path.exists():
        raise FileNotFoundError(f"Dataset zip not found: {zip_path}")

    dataset_name = sanitize_name(args.dataset_name)
    dataset_dir = DATASETS_DIR / dataset_name
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    extract_dataset(zip_path=zip_path, dataset_dir=dataset_dir, force_extract=args.force_extract)
    dataset_yaml = write_dataset_yaml(dataset_dir=dataset_dir, class_names=CLASS_NAMES)
    batch = resolve_batch(args.batch)
    manifest_path = dataset_dir / "training_manifest.json"
    write_manifest(
        manifest_path=manifest_path,
        zip_path=zip_path,
        dataset_dir=dataset_dir,
        dataset_yaml=dataset_yaml,
        batch=batch,
        args=args,
    )

    print(f"Dataset ready at: {dataset_dir}")
    print(f"Training YAML: {dataset_yaml}")
    print(f"Manifest: {manifest_path}")
    print(
        "Counts: "
        f"train={count_files(dataset_dir / 'train' / 'images')} "
        f"valid={count_files(dataset_dir / 'valid' / 'images')} "
        f"test={count_files(dataset_dir / 'test' / 'images')}"
    )
    print(
        "Training config: "
        f"model={args.model} epochs={args.epochs} imgsz={args.imgsz} "
        f"batch={'auto' if batch == -1 else batch} optimizer={args.optimizer} lr0={args.lr0}"
    )

    model = YOLO(args.model)
    run_dir = RUNS_DIR / args.run_name
    model.train(
        data=str(dataset_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=batch,
        optimizer=args.optimizer,
        lr0=args.lr0,
        cos_lr=True,
        device=args.device,
        project=str(RUNS_DIR),
        name=args.run_name,
        pretrained=True,
        workers=args.workers,
        exist_ok=True,
        amp=torch.cuda.is_available(),
        patience=args.epochs,
        seed=42,
        deterministic=True,
        cache=False,
        verbose=True,
    )

    exported = copy_best_weights(run_dir=run_dir, export_name=args.export_name)
    if exported is None:
        print(f"Training completed, but no best.pt was found under {run_dir}.")
        return

    print(f"Exported trained weights to: {exported}")


if __name__ == "__main__":
    main()
