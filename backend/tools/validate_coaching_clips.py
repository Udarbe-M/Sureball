from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


VALID_MODES = {"shooting_form", "dribbling", "passing"}
TERMINAL_STATUSES = {"completed", "error", "cancelled", "not_found"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate labeled shooting, dribbling, and passing clips against the backend.")
    parser.add_argument("--manifest", default="backend/validation/coaching_clip_manifest.example.json")
    parser.add_argument("--backend-url", default=None)
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    manifest = _load_manifest(manifest_path)
    backend_url = (args.backend_url or manifest.get("backend_url") or "http://127.0.0.1:8000").rstrip("/")
    samples = manifest.get("samples", [])
    if not isinstance(samples, list) or not samples:
      print("No validation samples found in manifest.")
      return 1

    failures = 0
    for sample in samples:
        try:
            result = _validate_sample(sample, backend_url=backend_url, timeout_seconds=args.timeout)
            failures += 0 if result else 1
        except Exception as exc:
            failures += 1
            print(f"[FAIL] {sample.get('id', '<unknown>')}: {exc}")

    if failures:
        print(f"\n{failures} validation sample(s) failed.")
        return 1
    print("\nAll coaching validation samples passed.")
    return 0


def _load_manifest(manifest_path: Path) -> dict:
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _validate_sample(sample: dict, *, backend_url: str, timeout_seconds: int) -> bool:
    sample_id = str(sample.get("id") or sample.get("video_path") or "sample")
    mode = str(sample.get("mode") or "")
    if mode not in VALID_MODES:
        raise ValueError(f"{sample_id} uses unsupported mode {mode!r}; expected shooting_form, dribbling, or passing.")

    video_path = Path(str(sample.get("video_path") or ""))
    if not video_path.exists():
        raise FileNotFoundError(f"{sample_id} video not found: {video_path}")

    expected_count = int(sample.get("expected_action_count"))
    tolerance = int(sample.get("tolerance", 0))
    start_response = _start_analysis(
        backend_url=backend_url,
        mode=mode,
        video_path=video_path,
        test_mode=bool(sample.get("test_mode", False)),
    )
    file_id = start_response["file_id"]
    status = _wait_for_status(backend_url=backend_url, file_id=file_id, timeout_seconds=timeout_seconds)

    if status.get("status") != "completed":
        print(f"[FAIL] {sample_id}: backend status {status.get('status')} ({status.get('error_message')})")
        return False

    actual_count = int(status.get("action_count") or 0)
    delta = abs(actual_count - expected_count)
    passed = delta <= tolerance
    details = [f"expected={expected_count}", f"actual={actual_count}", f"tolerance={tolerance}"]

    if mode == "shooting_form":
        shooting_stats = status.get("shooting_stats") or {}
        stat_checks = [
            ("makes", "expected_makes", int(sample.get("make_tolerance", tolerance))),
            ("misses", "expected_misses", int(sample.get("miss_tolerance", tolerance))),
        ]
        for actual_key, expected_key, stat_tolerance in stat_checks:
            if expected_key not in sample:
                continue
            expected_value = int(sample.get(expected_key))
            actual_value = int(shooting_stats.get(actual_key) or 0)
            stat_delta = abs(actual_value - expected_value)
            passed = passed and stat_delta <= stat_tolerance
            details.append(f"{actual_key}={actual_value}/{expected_value}")

        if "expected_accuracy" in sample:
            expected_accuracy = float(sample.get("expected_accuracy"))
            actual_accuracy = float(shooting_stats.get("accuracy") or 0.0)
            accuracy_tolerance = float(sample.get("accuracy_tolerance", 5.0))
            passed = passed and abs(actual_accuracy - expected_accuracy) <= accuracy_tolerance
            details.append(f"accuracy={actual_accuracy:.1f}/{expected_accuracy:.1f}±{accuracy_tolerance:.1f}")

    label = "PASS" if passed else "FAIL"
    print(f"[{label}] {sample_id}: mode={mode} {' '.join(details)}")
    return passed


def _start_analysis(*, backend_url: str, mode: str, video_path: Path, test_mode: bool) -> dict:
    fields = {
        "mode": mode,
        "overlay_mode": "score_only",
        "test_mode": str(test_mode).lower(),
        "user_key": "coaching-validation",
    }
    body, content_type = _multipart_body(fields=fields, file_field="video", file_path=video_path)
    request = Request(
        urljoin(f"{backend_url}/", "coaching-video/start"),
        data=body,
        headers={"Content-Type": content_type},
        method="POST",
    )
    return _json_request(request)


def _wait_for_status(*, backend_url: str, file_id: str, timeout_seconds: int) -> dict:
    deadline = time.time() + timeout_seconds
    status = {}
    while time.time() < deadline:
        request = Request(urljoin(f"{backend_url}/", f"coaching-video/status/{file_id}"), method="GET")
        status = _json_request(request)
        if status.get("status") in TERMINAL_STATUSES:
            return status
        time.sleep(1.5)
    raise TimeoutError(f"Timed out waiting for validation job {file_id}; last status was {status}")


def _json_request(request: Request) -> dict:
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Backend request failed with HTTP {exc.code}: {details}") from exc
    except URLError as exc:
        raise RuntimeError(f"Unable to reach backend: {exc.reason}") from exc


def _multipart_body(*, fields: dict[str, str], file_field: str, file_path: Path) -> tuple[bytes, str]:
    boundary = f"----sureball-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )

    mime_type = mimetypes.guess_type(file_path.name)[0] or "video/mp4"
    chunks.extend(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            (
                f'Content-Disposition: form-data; name="{file_field}"; '
                f'filename="{file_path.name}"\r\n'
            ).encode("utf-8"),
            f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
            file_path.read_bytes(),
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


if __name__ == "__main__":
    sys.exit(main())
