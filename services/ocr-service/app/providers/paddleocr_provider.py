"""Real OCR provider — CR-001 Sprint OCR-03 (design brief §2-§5).

Treated as an *initial* printed-text OCR engine, not a guaranteed
handwriting solution (design brief §11) — `supports_handwriting` stays
False until a dedicated evaluation says otherwise. Never rewrites or
fabricates text: whatever the model returns is `raw_text`, unmodified;
normalization only ever produces a separate, additional field (see
app/ocr/normalization.py).

IMPORTANT — unverified in the current development sandbox: this file was
written against PaddleOCR/PaddleX 3.x's *documented and source-inspected*
API (paddlex/inference/pipelines/ocr/pipeline.py's `predict()`, whose
per-image result exposes `rec_texts` / `rec_scores` / `rec_polys`), but
no real inference has been run against it here — this sandbox's egress
policy blocks both of PaddleX's model-weight sources (bcebos.com,
huggingface.co), so the actual model download never completes. Model
loading is deliberately lazy (see `initialize()`) so the rest of this
service starts and serves `/health`/`/ready` successfully regardless.
"""

from __future__ import annotations

import logging
import threading

import cv2
import httpx
import numpy as np

from app.config import RUNTIME
from app.ocr.language_routing import LanguageCandidate, merge_language_results
from app.ocr.normalization import normalize_text
from app.ocr.reading_order import ReadingOrderBlock, sort_reading_order
from app.providers.capabilities import ProviderCapabilities
from app.schemas import OCRBlock, RecognitionCandidateDto

logger = logging.getLogger("app.providers.paddleocr")

IMAGE_FETCH_TIMEOUT_SECONDS = 30

# lang code -> (script, direction) — the only two script families this
# phase configures (design brief §4); a future sprint can extend this
# without touching the merge/reading-order logic, which is script-agnostic.
_LANGUAGE_META = {
    "en": ("LATIN", "LTR"),
    "ar": ("ARABIC", "RTL"),
}


class PaddleOCRInitializationError(RuntimeError):
    pass


class PaddleOCRProvider:
    name = "paddleocr"
    # Not claimed True — no fixture-based handwriting evaluation has been
    # run against this provider (design brief §11, and the explicit
    # instruction not to claim this without running that evaluation).
    supports_handwriting = False
    is_local = True

    def __init__(self) -> None:
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()
        self._ready = False
        self._init_error: str | None = None
        self._model_names: dict[str, str] = {}

    # ── lifecycle ──────────────────────────────────────────────────────

    def initialize(self) -> None:
        """Idempotent, thread-safe, lazy. Called once — either a best-
        effort attempt at FastAPI startup (non-fatal on failure, see
        main.py) or lazily on the first real request. Never re-loads
        models on subsequent calls once ready."""
        if self._ready or self._init_error:
            return
        with self._lock:
            if self._ready or self._init_error:
                return
            try:
                from paddleocr import PaddleOCR  # imported lazily: keeps

                # this module importable (for is_ready()/get_provider_info()
                # health reporting) even if paddleocr itself is missing.
                common_kwargs = {
                    "device": RUNTIME.device,
                    "use_doc_orientation_classify": RUNTIME.enable_orientation,
                    "use_doc_unwarping": RUNTIME.enable_document_unwarping,
                    "use_textline_orientation": RUNTIME.enable_orientation,
                }
                if RUNTIME.enable_english:
                    self._pipelines["en"] = PaddleOCR(lang="en", **common_kwargs)
                    self._model_names["en"] = "en_PP-OCRv5_mobile_rec"
                if RUNTIME.enable_arabic:
                    self._pipelines["ar"] = PaddleOCR(lang="ar", **common_kwargs)
                    self._model_names["ar"] = "arabic_PP-OCRv3_mobile_rec"
                if not self._pipelines:
                    raise PaddleOCRInitializationError(
                        "No language pipelines enabled (OCR_ENABLE_ARABIC and "
                        "OCR_ENABLE_ENGLISH are both false)"
                    )
                self._ready = True
                logger.info("PaddleOCR ready: languages=%s", list(self._pipelines))
            except Exception as exc:  # noqa: BLE001 — recorded, not swallowed
                self._init_error = str(exc)
                logger.warning("PaddleOCR initialization failed: %s", exc)
                raise

    def is_ready(self) -> bool:
        return self._ready

    def get_provider_info(self) -> dict:
        return {
            "name": self.name,
            "ready": self._ready,
            "initError": self._init_error,
            "languages": list(self._pipelines) if self._ready else [],
            "models": dict(self._model_names) if self._ready else {},
            "device": RUNTIME.device,
            "capabilities": self.capabilities().to_camel_case_dict(),
        }

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supports_printed_text=True,
            supports_handwriting=False,
            supports_arabic=RUNTIME.enable_arabic,
            supports_english=RUNTIME.enable_english,
            supports_mixed_language=RUNTIME.enable_arabic and RUNTIME.enable_english,
        )

    def health_check(self) -> bool:
        # Deliberately does not attempt initialize() here — a health probe
        # must be cheap and must not block on (or trigger) a multi-second
        # model load; "ready" and "healthy" are different questions here.
        return self._ready or self._init_error is None

    # ── recognition ────────────────────────────────────────────────────

    def _fetch_image(self, image_url: str) -> np.ndarray:
        resp = httpx.get(image_url, timeout=IMAGE_FETCH_TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = np.frombuffer(resp.content, dtype=np.uint8)
        bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("fetched bytes are not a decodable image")
        return bgr

    def _recognize_language(self, lang: str, bgr: np.ndarray) -> list[LanguageCandidate]:
        pipeline = self._pipelines[lang]
        script, direction = _LANGUAGE_META[lang]
        results = list(pipeline.predict(bgr))  # type: ignore[attr-defined]
        if not results:
            return []
        res = results[0]
        texts = res.get("rec_texts", [])
        scores = res.get("rec_scores", [])
        polys = res.get("rec_polys", [])
        candidates: list[LanguageCandidate] = []
        for text, score, poly in zip(texts, scores, polys):
            if not text or not text.strip():
                continue
            points = [(float(p[0]), float(p[1])) for p in poly]
            candidates.append(
                LanguageCandidate(
                    text=text,
                    confidence=float(score),
                    language=lang,
                    script=script,
                    direction=direction,
                    polygon=points,
                )
            )
        return candidates

    def detect_and_recognize(self, image_url: str) -> list[OCRBlock]:
        self.initialize()
        bgr = self._fetch_image(image_url)

        candidates_by_language: dict[str, list[LanguageCandidate]] = {}
        for lang in self._pipelines:
            candidates_by_language[lang] = self._recognize_language(lang, bgr)

        merged = merge_language_results(candidates_by_language)

        order_input = [
            ReadingOrderBlock(
                index=i,
                x=min(p[0] for p in region.primary.polygon),
                y=min(p[1] for p in region.primary.polygon),
                width=max(p[0] for p in region.primary.polygon)
                - min(p[0] for p in region.primary.polygon),
                height=max(p[1] for p in region.primary.polygon)
                - min(p[1] for p in region.primary.polygon),
                direction=region.primary.direction,
            )
            for i, region in enumerate(merged)
        ]
        order = sort_reading_order(order_input)

        blocks: list[OCRBlock] = []
        for line_number, region_index in enumerate(order, start=1):
            region = merged[region_index]
            primary = region.primary
            xs = [p[0] for p in primary.polygon]
            ys = [p[1] for p in primary.polygon]
            blocks.append(
                OCRBlock(
                    rawText=primary.text,
                    normalizedText=normalize_text(primary.text, primary.script),
                    boundingBox={
                        "x": min(xs),
                        "y": min(ys),
                        "width": max(xs) - min(xs),
                        "height": max(ys) - min(ys),
                    },
                    language=primary.language,
                    confidence=primary.confidence,
                    lineNumber=line_number,
                    blockIndex=region_index,
                    boundingPolygon=[[p[0], p[1]] for p in primary.polygon],
                    script=primary.script,
                    direction=primary.direction,
                    recognitionCandidates=[
                        RecognitionCandidateDto(
                            text=alt.text, language=alt.language, confidence=alt.confidence
                        )
                        for alt in region.alternatives
                    ]
                    if region.ambiguous
                    else [],
                )
            )
        return blocks
