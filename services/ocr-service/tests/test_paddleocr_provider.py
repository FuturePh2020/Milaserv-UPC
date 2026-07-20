"""CR-001 Sprint OCR-03 — PaddleOCRProvider orchestration logic.

Tests this provider's own code (lazy singleton lifecycle, error handling,
merge/reading-order/normalization wiring) with a *fake* `paddleocr`
module injected via monkeypatch — never the real library. This is
deliberate: whether the real PaddleOCR/PaddleX model download succeeds
depends on the network policy of wherever these tests run (blocked in
this development sandbox, confirmed via app/config.py's docstring),
which would make a test asserting on real inference flaky/environment-
coupled. What's tested here is "does this provider correctly drive
whatever PaddleOCR returns" — real recognition accuracy is a separate,
explicit evaluation (scripts/evaluate_ocr.py), never claimed here.
"""

from __future__ import annotations

import sys
import types

import pytest

from app.providers.paddleocr_provider import PaddleOCRProvider
from tests.fixtures import sharp_document_bytes


class _FakePaddleOCRPipeline:
    def __init__(self, lang: str, result: dict | None = None, **_kwargs):
        self.lang = lang
        self._result = result or {"rec_texts": [], "rec_scores": [], "rec_polys": []}

    def predict(self, _image):
        yield self._result


def _install_fake_paddleocr(monkeypatch, *, results_by_lang: dict[str, dict] | None = None, fail: bool = False):
    results_by_lang = results_by_lang or {}
    fake_module = types.ModuleType("paddleocr")

    def _factory(*, lang, **kwargs):  # noqa: ANN001
        if fail:
            raise RuntimeError("simulated model-source failure")
        return _FakePaddleOCRPipeline(lang, results_by_lang.get(lang))

    fake_module.PaddleOCR = _factory
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)


def _install_fake_image_fetch(monkeypatch):
    class FakeResponse:
        def __init__(self, content: bytes):
            self.content = content

        def raise_for_status(self):
            return None

    def fake_get(url, timeout=None):  # noqa: ARG001
        return FakeResponse(sharp_document_bytes())

    monkeypatch.setattr("app.providers.paddleocr_provider.httpx.get", fake_get)


def test_initialize_is_idempotent(monkeypatch):
    calls = {"count": 0}
    fake_module = types.ModuleType("paddleocr")

    def _factory(*, lang, **kwargs):  # noqa: ANN001
        calls["count"] += 1
        return _FakePaddleOCRPipeline(lang)

    fake_module.PaddleOCR = _factory
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)

    provider = PaddleOCRProvider()
    provider.initialize()
    provider.initialize()
    provider.initialize()
    assert calls["count"] == 2  # one per enabled language (en + ar), not per call
    assert provider.is_ready() is True


def test_initialization_failure_is_recorded_not_raised_silently(monkeypatch):
    _install_fake_paddleocr(monkeypatch, fail=True)
    provider = PaddleOCRProvider()
    with pytest.raises(RuntimeError):
        provider.initialize()
    assert provider.is_ready() is False
    info = provider.get_provider_info()
    assert info["ready"] is False
    assert "simulated model-source failure" in info["initError"]


def test_get_provider_info_reports_camel_case_capabilities(monkeypatch):
    _install_fake_paddleocr(monkeypatch)
    provider = PaddleOCRProvider()
    info = provider.get_provider_info()
    assert set(info["capabilities"].keys()) == {
        "supportsPrintedText",
        "supportsHandwriting",
        "supportsArabic",
        "supportsEnglish",
        "supportsMixedLanguage",
    }
    assert info["capabilities"]["supportsHandwriting"] is False


def test_detect_and_recognize_merges_reading_order_and_normalizes(monkeypatch):
    en_result = {
        "rec_texts": ["Augmentin", "1 gm"],
        "rec_scores": [0.95, 0.9],
        "rec_polys": [
            [[10, 10], [110, 10], [110, 30], [10, 30]],
            [[10, 50], [80, 50], [80, 70], [10, 70]],
        ],
    }
    ar_result = {"rec_texts": [], "rec_scores": [], "rec_polys": []}
    _install_fake_paddleocr(monkeypatch, results_by_lang={"en": en_result, "ar": ar_result})
    _install_fake_image_fetch(monkeypatch)

    provider = PaddleOCRProvider()
    blocks = provider.detect_and_recognize("http://fixtures.local/image")

    assert [b.raw_text for b in blocks] == ["Augmentin", "1 gm"]
    assert [b.line_number for b in blocks] == [1, 2]
    assert blocks[0].normalized_text == "augmentin"
    assert blocks[0].script == "LATIN"
    assert blocks[0].direction == "LTR"
    assert blocks[0].bounding_polygon == [[10.0, 10.0], [110.0, 10.0], [110.0, 30.0], [10.0, 30.0]]
    assert blocks[0].recognition_candidates == []  # not ambiguous — no competing language hit


def test_detect_and_recognize_never_fabricates_when_nothing_detected(monkeypatch):
    empty = {"rec_texts": [], "rec_scores": [], "rec_polys": []}
    _install_fake_paddleocr(monkeypatch, results_by_lang={"en": empty, "ar": empty})
    _install_fake_image_fetch(monkeypatch)

    provider = PaddleOCRProvider()
    blocks = provider.detect_and_recognize("http://fixtures.local/image")
    assert blocks == []
