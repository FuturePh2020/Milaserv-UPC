"""CR-001 Sprint OCR-02 Extension — Universal Image Intake.

Exercises the real /v1/detect-region endpoint end-to-end (httpx.get is
monkeypatched to serve the synthetic fixtures below — everything after
that, including PNG/JPEG decoding and every CV/heuristic step, runs for
real, same pattern as tests/test_preprocessing.py).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests import region_fixtures as fx

client = TestClient(app)

FIXTURE_URL = "http://fixtures.local/image"


@pytest.fixture(autouse=True)
def _serve_fixture(monkeypatch):
    state = {"payload": fx.single_image_screenshot_bytes()}

    class FakeResponse:
        def __init__(self, content: bytes):
            self.content = content

        def raise_for_status(self):
            return None

    def fake_get(url, timeout=None):  # noqa: ARG001
        return FakeResponse(state["payload"])

    monkeypatch.setattr("app.main.httpx.get", fake_get)
    yield state


def _detect(state, payload: bytes, config: dict | None = None) -> dict:
    state["payload"] = payload
    body = {"imageUrl": FIXTURE_URL}
    if config:
        body["config"] = config
    res = client.post("/v1/detect-region", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_android_whatsapp_screenshot_is_detected(_serve_fixture):
    body = _detect(_serve_fixture, fx.android_whatsapp_screenshot_bytes())
    assert body["screenshotDetected"] is True
    assert body["sourceTypeHint"] == "WHATSAPP_SCREENSHOT"
    assert body["screenshotApplicationHint"] == "whatsapp"


def test_iphone_whatsapp_screenshot_is_detected(_serve_fixture):
    body = _detect(_serve_fixture, fx.iphone_whatsapp_screenshot_bytes())
    assert body["screenshotDetected"] is True
    assert body["sourceTypeHint"] == "WHATSAPP_SCREENSHOT"


def test_whatsapp_dark_mode_screenshot_is_detected(_serve_fixture):
    body = _detect(_serve_fixture, fx.whatsapp_dark_mode_screenshot_bytes())
    assert body["screenshotDetected"] is True
    assert body["screenshotApplicationHint"] == "whatsapp"


def test_whatsapp_light_mode_screenshot_is_detected(_serve_fixture):
    body = _detect(_serve_fixture, fx.whatsapp_light_mode_screenshot_bytes())
    assert body["screenshotDetected"] is True
    assert body["screenshotApplicationHint"] == "whatsapp"


def test_generic_screenshot_with_status_bar_detected_without_whatsapp_hint(_serve_fixture):
    body = _detect(_serve_fixture, fx.generic_status_bar_screenshot_bytes())
    assert body["screenshotDetected"] is True
    assert body["screenshotApplicationHint"] is None
    assert body["sourceTypeHint"] == "SCREENSHOT"


def test_screenshot_with_chat_bubbles_finds_the_content_bearing_region(_serve_fixture):
    body = _detect(_serve_fixture, fx.chat_bubbles_screenshot_bytes())
    assert body["screenshotDetected"] is True
    assert body["bestRegionIndex"] is not None
    best = body["regions"][body["bestRegionIndex"]]
    # The content bubble is roughly centered — the flat placeholder
    # bubbles above/below should not outscore it.
    assert best["width"] > 400
    assert best["height"] > 400


def test_screenshot_with_black_borders_excludes_the_letterbox(_serve_fixture):
    body = _detect(_serve_fixture, fx.black_border_screenshot_bytes())
    assert body["bestRegionIndex"] is not None
    best = body["regions"][body["bestRegionIndex"]]
    # The chosen region should sit inside the content band, not span the
    # full (mostly black) frame.
    assert best["height"] < 2280 * 0.9


def test_screenshot_with_one_prescription_image_yields_one_strong_candidate(_serve_fixture):
    body = _detect(_serve_fixture, fx.single_image_screenshot_bytes())
    assert body["bestRegionIndex"] is not None
    assert len(body["regions"]) >= 1


def test_screenshot_with_multiple_images_returns_every_candidate(_serve_fixture):
    body = _detect(_serve_fixture, fx.multiple_images_screenshot_bytes())
    # Design doc: "Do not silently discard uncertain regions" — with two
    # genuinely separate content blocks, more than one candidate must
    # survive.
    assert len(body["regions"]) >= 2


def test_cropped_chat_screenshot_still_finds_content_without_a_header_band(_serve_fixture):
    body = _detect(_serve_fixture, fx.cropped_chat_screenshot_bytes())
    assert body["bestRegionIndex"] is not None
    assert len(body["regions"]) >= 1


def test_camera_photo_is_never_classified_as_a_screenshot(_serve_fixture):
    body = _detect(_serve_fixture, fx.camera_photo_bytes())
    assert body["screenshotDetected"] is False
    assert body["sourceTypeHint"] == "CAMERA"


def test_scanned_image_is_classified_as_scanner(_serve_fixture):
    body = _detect(_serve_fixture, fx.scanned_image_bytes())
    assert body["screenshotDetected"] is False
    assert body["sourceTypeHint"] == "SCANNER"


def test_low_confidence_region_requires_manual_crop(_serve_fixture):
    body = _detect(_serve_fixture, fx.low_confidence_blank_bytes())
    assert body["manualCropRequired"] is True


def test_high_min_confidence_config_forces_manual_crop_even_for_a_good_region(_serve_fixture):
    body = _detect(
        _serve_fixture,
        fx.single_image_screenshot_bytes(),
        config={"minConfidence": 0.99},
    )
    assert body["manualCropRequired"] is True


def test_disabling_region_detection_returns_no_regions_and_requires_manual_crop(_serve_fixture):
    body = _detect(
        _serve_fixture,
        fx.single_image_screenshot_bytes(),
        config={"enabled": False},
    )
    assert body["regions"] == []
    assert body["manualCropRequired"] is True


def test_pdf_is_reported_as_pdf_source_type_with_no_manual_crop(_serve_fixture):
    import io

    from PIL import Image

    page = Image.new("RGB", (600, 800), (255, 255, 255))
    buf = io.BytesIO()
    page.save(buf, format="PDF")
    body = _detect(_serve_fixture, buf.getvalue())
    assert body["sourceTypeHint"] == "PDF"
    assert body["manualCropRequired"] is False


def test_never_discards_the_original_image_dimensions(_serve_fixture):
    body = _detect(_serve_fixture, fx.android_whatsapp_screenshot_bytes())
    assert body["originalWidth"] == 1080
    assert body["originalHeight"] == 2280
