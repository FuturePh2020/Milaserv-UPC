"""Fixture-based OCR accuracy evaluation — CR-001 Sprint OCR-03 design
brief §19 ("Evaluation Dataset & Testing": CER/WER/precision/recall/
confidence/timing, synthetic/anonymized data only).

Run from services/ocr-service/ (needs the app/ package on the path and
this service's own venv):

    python -m evaluation.evaluate_ocr --provider mock
    python -m evaluation.evaluate_ocr --provider paddleocr

Every fixture image is served over a throwaway local HTTP server so each
provider goes through the exact same image_url + httpx fetch path
production traffic takes — there is no separate "local file" code path
to keep in sync with app/providers/*.py by hand.

What this does NOT do: it does not by itself justify any "Arabic
support" or "handwriting support" claim. A provider that fails to
initialize (e.g. PaddleOCR with its model weights unreachable) is
reported as ABORTED with the failure reason, never silently skipped or
scored as if it had run.
"""

from __future__ import annotations

import argparse
import http.server
import json
import statistics
import sys
import threading
import time
from dataclasses import asdict, dataclass
from functools import partial
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE_ROOT = HERE.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from evaluation.dataset.generate_fixtures import IMAGES_DIR, MANIFEST_PATH, generate  # noqa: E402
from evaluation.metrics import character_error_rate, word_error_rate  # noqa: E402


@dataclass
class FixtureResult:
    id: str
    language: str
    category: str
    ground_truth: str
    recognized: str
    cer: float
    wer: float
    confidence: float
    duration_ms: float
    detected: bool
    expected_detection: bool


def _serve_images(directory: Path) -> tuple[http.server.ThreadingHTTPServer, threading.Thread]:
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def _load_manifest() -> list[dict]:
    needs_generate = (
        not MANIFEST_PATH.exists()
        or not IMAGES_DIR.exists()
        or not any(IMAGES_DIR.glob("*.png"))
    )
    if needs_generate:
        generate()
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def run(provider_name: str) -> dict:
    from app.providers.base import registry
    from app.providers.mock import MockOCRProvider
    from app.providers.paddleocr_provider import PaddleOCRProvider

    registry.register(MockOCRProvider(), default=True)
    registry.register(PaddleOCRProvider())
    provider = registry.get(provider_name)

    init_error: str | None = None
    try:
        provider.initialize()
    except Exception as exc:  # noqa: BLE001 — reported, not swallowed
        init_error = f"{type(exc).__name__}: {exc}"

    if not provider.is_ready():
        return {
            "provider": provider_name,
            "status": "ABORTED",
            "reason": init_error or "provider reported not ready after initialize()",
            "fixtures": [],
        }

    manifest = _load_manifest()
    server, _thread = _serve_images(IMAGES_DIR)
    port = server.server_address[1]
    try:
        results: list[FixtureResult] = []
        for entry in manifest:
            url = f"http://127.0.0.1:{port}/{entry['image']}"
            started = time.monotonic()
            try:
                blocks = provider.detect_and_recognize(url)
                duration_ms = (time.monotonic() - started) * 1000
            except Exception as exc:  # noqa: BLE001
                results.append(
                    FixtureResult(
                        id=entry["id"],
                        language=entry["language"],
                        category=entry["category"],
                        ground_truth=entry["groundTruthText"],
                        recognized=f"<error: {type(exc).__name__}: {exc}>",
                        cer=1.0,
                        wer=1.0,
                        confidence=0.0,
                        duration_ms=(time.monotonic() - started) * 1000,
                        detected=False,
                        expected_detection=bool(entry["groundTruthText"].strip()),
                    )
                )
                continue

            ordered = sorted(blocks, key=lambda b: b.line_number)
            recognized_text = " ".join(b.raw_text for b in ordered).strip()
            confidence = statistics.mean(b.confidence for b in blocks) if blocks else 0.0
            results.append(
                FixtureResult(
                    id=entry["id"],
                    language=entry["language"],
                    category=entry["category"],
                    ground_truth=entry["groundTruthText"],
                    recognized=recognized_text,
                    cer=character_error_rate(entry["groundTruthText"], recognized_text),
                    wer=word_error_rate(entry["groundTruthText"], recognized_text),
                    confidence=confidence,
                    duration_ms=duration_ms,
                    detected=len(blocks) > 0,
                    expected_detection=bool(entry["groundTruthText"].strip()),
                )
            )
    finally:
        server.shutdown()

    return {"provider": provider_name, "status": "COMPLETED", "fixtures": [asdict(r) for r in results]}


def _summarize(report: dict) -> dict:
    fixtures = report["fixtures"]
    if not fixtures:
        return {"count": 0}

    def _by(lang: str | None) -> list[dict]:
        return [f for f in fixtures if lang is None or f["language"] == lang]

    def _agg(subset: list[dict]) -> dict:
        if not subset:
            return {}
        tp = sum(1 for f in subset if f["detected"] and f["expected_detection"])
        fp = sum(1 for f in subset if f["detected"] and not f["expected_detection"])
        fn = sum(1 for f in subset if not f["detected"] and f["expected_detection"])
        precision = tp / (tp + fp) if (tp + fp) else None
        recall = tp / (tp + fn) if (tp + fn) else None
        return {
            "count": len(subset),
            "meanCer": round(statistics.mean(f["cer"] for f in subset), 4),
            "meanWer": round(statistics.mean(f["wer"] for f in subset), 4),
            "meanConfidence": round(statistics.mean(f["confidence"] for f in subset), 4),
            "meanDurationMs": round(statistics.mean(f["duration_ms"] for f in subset), 2),
            # Fixture-level presence precision/recall ("did we detect text
            # exactly when the fixture had any") — NOT region-level IoU
            # precision/recall, since this synthetic set carries no
            # per-region ground truth. Documented explicitly so it is
            # never mistaken for the design brief's region-level metric.
            "detectionPrecision": round(precision, 4) if precision is not None else None,
            "detectionRecall": round(recall, 4) if recall is not None else None,
        }

    return {
        "overall": _agg(fixtures),
        "en": _agg(_by("en")),
        "ar": _agg(_by("ar")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", default="mock", choices=["mock", "paddleocr"])
    parser.add_argument("--out", default=None, help="Output JSON path (default: evaluation/results/<provider>-<ts>.json)")
    args = parser.parse_args()

    report = run(args.provider)
    report["summary"] = _summarize(report)

    out_path = Path(args.out) if args.out else HERE / "results" / f"{args.provider}-{int(time.time())}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"provider={report['provider']} status={report['status']}")
    if report["status"] != "COMPLETED":
        print(f"reason: {report.get('reason')}")
    else:
        for scope in ("overall", "en", "ar"):
            s = report["summary"].get(scope) or {}
            if not s:
                continue
            print(
                f"[{scope}] n={s['count']} CER={s['meanCer']} WER={s['meanWer']} "
                f"conf={s['meanConfidence']} precision={s['detectionPrecision']} "
                f"recall={s['detectionRecall']} avgMs={s['meanDurationMs']}"
            )
    print(f"full report: {out_path}")


if __name__ == "__main__":
    main()
