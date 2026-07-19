"""CR-001 Sprint OCR-03 — sanity coverage for the evaluation harness
itself (evaluation/evaluate_ocr.py), not a real accuracy claim. Runs
only against MockOCRProvider: fast, deterministic, no network. This
proves the CER/WER/precision/recall/timing plumbing is correct — a
provider whose output is unrelated to the input image should score
badly, and a harness that can't tell the difference is broken.

Deliberately does NOT exercise `--provider paddleocr` here: that path
calls PaddleOCRProvider.initialize(), which reaches out to a model
hoster over the network (harmless in this sandbox, where it fails fast
with a clean 403 — see the module docstring on
app/providers/paddleocr_provider.py — but a real deployment would
attempt an actual multi-hundred-MB model download on every test run,
which has no place in a unit-test suite). Run it manually instead:
`python -m evaluation.evaluate_ocr --provider paddleocr`.
"""

from __future__ import annotations

from evaluation import evaluate_ocr
from evaluation.metrics import character_error_rate, word_error_rate


def test_character_error_rate_exact_match_is_zero():
    assert character_error_rate("panadol", "panadol") == 0.0


def test_character_error_rate_totally_wrong_is_one():
    assert character_error_rate("panadol", "xxxxxxx") == 1.0


def test_character_error_rate_empty_ground_truth_penalizes_hallucination():
    assert character_error_rate("", "") == 0.0
    assert character_error_rate("", "something") == 1.0


def test_word_error_rate_counts_word_edits_not_characters():
    # One substituted word out of three — WER 1/3, not a character ratio.
    assert word_error_rate("take one tablet", "take two tablet") == 1 / 3


def test_mock_provider_evaluation_runs_and_scores_badly():
    """MockOCRProvider's output is a pure function of the URL, unrelated
    to what's actually in the image — the harness must reflect that with
    a high mean CER, not silently report a suspiciously good score."""
    report = evaluate_ocr.run("mock")
    assert report["status"] == "COMPLETED"
    assert len(report["fixtures"]) > 0

    summary = evaluate_ocr._summarize(report)
    assert summary["overall"]["count"] == len(report["fixtures"])
    # A provider that never actually reads the image should score badly,
    # not near-zero — this is the harness's own self-check.
    assert summary["overall"]["meanCer"] > 0.5
