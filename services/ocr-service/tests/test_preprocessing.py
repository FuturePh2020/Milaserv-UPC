"""CR-001 Sprint OCR-02 — Image Processing & Quality Engine.

Exercises the real /v1/preprocess endpoint end-to-end (httpx.get is
monkeypatched to serve the synthetic fixtures below instead of a real
network fetch — everything after that point, including PNG/PDF decoding
and every CV step, runs for real).
"""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from tests import fixtures

client = TestClient(app)

FIXTURE_URL = "http://fixtures.local/image"


@pytest.fixture(autouse=True)
def _serve_fixture(monkeypatch):
    """Points every request at whatever bytes the test assigns to
    `_serve_fixture.payload` before calling the endpoint."""
    state = {"payload": fixtures.sharp_document_bytes()}

    class FakeResponse:
        def __init__(self, content: bytes):
            self.content = content

        def raise_for_status(self):
            return None

    def fake_get(url, timeout=None):  # noqa: ARG001 — signature must match httpx.get
        return FakeResponse(state["payload"])

    monkeypatch.setattr("app.main.httpx.get", fake_get)
    yield state


def _preprocess(state, payload: bytes, config: dict | None = None) -> dict:
    state["payload"] = payload
    body = {"imageUrl": FIXTURE_URL}
    if config:
        body["config"] = config
    res = client.post("/v1/preprocess", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _decode_version(body: dict, key: str) -> Image.Image:
    raw = base64.b64decode(body["versions"][key]["imageBase64"])
    return Image.open(io.BytesIO(raw))


def test_sharp_document_scores_well_and_is_not_flagged_for_reupload(_serve_fixture):
    body = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    assert body["qualityStatus"] != "REUPLOAD_REQUIRED"
    assert body["metrics"]["blurScore"] > 0.7
    assert "OCR_READY" in body["versions"]
    assert "ENHANCED" in body["versions"]
    assert body["pageCount"] == 1
    assert body["pages"] is None


def test_blurry_image_scores_lower_blur_than_sharp(_serve_fixture):
    sharp = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    blurry = _preprocess(_serve_fixture, fixtures.blurry_document_bytes())
    assert blurry["metrics"]["blurScore"] < sharp["metrics"]["blurScore"]


def test_rotated_image_reports_a_nonzero_rotation_angle(_serve_fixture):
    body = _preprocess(_serve_fixture, fixtures.rotated_document_bytes(12.0))
    assert abs(body["metrics"]["rotationAngle"]) > 1.0


def test_dark_image_reports_low_brightness_mean_and_score(_serve_fixture):
    sharp = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    dark = _preprocess(_serve_fixture, fixtures.dark_document_bytes())
    assert dark["metrics"]["brightnessMean"] < sharp["metrics"]["brightnessMean"]
    assert dark["metrics"]["brightnessScore"] < sharp["metrics"]["brightnessScore"]


def test_bright_image_reports_high_brightness_mean_and_lower_score(_serve_fixture):
    sharp = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    bright = _preprocess(_serve_fixture, fixtures.bright_document_bytes())
    assert bright["metrics"]["brightnessMean"] > sharp["metrics"]["brightnessMean"]
    assert bright["metrics"]["brightnessScore"] < sharp["metrics"]["brightnessScore"]


def test_noisy_image_scores_lower_noise_score_than_sharp(_serve_fixture):
    sharp = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    noisy = _preprocess(_serve_fixture, fixtures.noisy_document_bytes())
    assert noisy["metrics"]["noiseScore"] < sharp["metrics"]["noiseScore"]
    assert noisy["metrics"]["noiseLevel"] > sharp["metrics"]["noiseLevel"]


def test_cropped_scene_detects_the_document_and_crops_to_it(_serve_fixture):
    scene = _preprocess(_serve_fixture, fixtures.cropped_scene_bytes())
    assert scene["metrics"]["cropConfidence"] > 0.3
    assert "CROPPED" in scene["versions"]
    cropped_img = _decode_version(scene, "CROPPED")
    original_w = scene["metrics"]["width"]
    assert cropped_img.width < original_w


def test_low_resolution_image_fails_resolution_check_and_lowers_quality_score(_serve_fixture):
    sharp = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    low_res = _preprocess(_serve_fixture, fixtures.low_resolution_document_bytes())
    assert low_res["metrics"]["resolutionOk"] is False
    assert low_res["qualityScore"] < sharp["qualityScore"]


def test_multi_page_pdf_preprocessing_reports_every_page(_serve_fixture):
    body = _preprocess(_serve_fixture, fixtures.multi_page_pdf_bytes(3))
    assert body["pageCount"] == 3
    assert body["pages"] is not None
    assert len(body["pages"]) == 3
    for page in body["pages"]:
        assert "OCR_READY" in page["versions"]


def test_below_threshold_quality_score_is_marked_reupload_required(_serve_fixture):
    # Stack multiple degradations so the aggregate score genuinely drops
    # below the (raised) threshold — proves the configurable
    # MIN_QUALITY_SCORE gate actually gates.
    body = _preprocess(
        _serve_fixture,
        fixtures.blurry_document_bytes(),
        config={"minQualityScore": 95},
    )
    assert body["qualityStatus"] == "REUPLOAD_REQUIRED"


def test_disabled_processor_is_skipped_and_omitted_from_stages_applied(_serve_fixture):
    body = _preprocess(
        _serve_fixture,
        fixtures.sharp_document_bytes(),
        config={"enabled": {"sharpening": False, "shadowRemoval": False}},
    )
    assert "sharpening" not in body["stagesApplied"]
    assert "shadowRemoval" not in body["stagesApplied"]


def test_processor_timings_and_no_failures_on_a_clean_image(_serve_fixture):
    body = _preprocess(_serve_fixture, fixtures.sharp_document_bytes())
    assert body["processorFailures"] == []
    assert body["processingDurationMs"] >= 0
    assert len(body["processorTimingsMs"]) > 0
