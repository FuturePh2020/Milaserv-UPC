"""Deterministic mock OCR provider — Sprint OCR-01 (CR-001 §10).

Real computer vision (PaddleOCR/Tesseract) ships in OCR-02/OCR-03. Until
then this provider lets the whole pipeline — upload, queue, page
lifecycle, text-block/candidate persistence, review-queue plumbing — be
built and tested end-to-end without a real OCR engine. Every response is
a pure function of the input `image_url`, so the same URL always yields
the same canned result (required for repeatable tests).
"""

from __future__ import annotations

import hashlib

from app.schemas import OCRBlock

# Three canned fixtures covering the shapes callers need to test against:
# a normal two-line prescription, a single low-confidence illegible line,
# and an empty page (no text detected at all).
_FIXTURES: list[list[OCRBlock]] = [
    [
        OCRBlock(
            rawText="Panadol Extra Tab",
            normalizedText="panadol extra tab",
            boundingBox={"x": 10, "y": 10, "width": 220, "height": 30},
            language="en",
            confidence=0.93,
            lineNumber=1,
        ),
        OCRBlock(
            rawText="Augmentin 1 gm",
            normalizedText="augmentin 1 gm",
            boundingBox={"x": 10, "y": 50, "width": 200, "height": 30},
            language="en",
            confidence=0.89,
            lineNumber=2,
        ),
    ],
    [
        OCRBlock(
            rawText="xzq scrwl unreadable",
            normalizedText="xzq scrwl unreadable",
            boundingBox={"x": 10, "y": 10, "width": 180, "height": 30},
            language="en",
            confidence=0.28,
            lineNumber=1,
        ),
    ],
    [],
]


def _bucket(image_url: str, count: int) -> int:
    digest = hashlib.sha1(image_url.encode("utf-8")).hexdigest()
    return int(digest, 16) % count


class MockOCRProvider:
    name = "mock"
    supports_handwriting = False
    is_local = True

    def detect_and_recognize(self, image_url: str) -> list[OCRBlock]:
        return list(_FIXTURES[_bucket(image_url, len(_FIXTURES))])

    def health_check(self) -> bool:
        return True


def mock_quality_score(image_url: str) -> tuple[float, list[str]]:
    """Filename convention drives the mock quality gate so callers can
    deterministically exercise IMAGE_REUPLOAD_REQUIRED without needing an
    actual blurry image: any URL containing "lowquality" scores low.
    """
    if "lowquality" in image_url.lower():
        return 0.2, ["BLUR", "LOW_RESOLUTION"]
    return 0.85, []


def mock_medicine_lines(blocks: list[OCRBlock]) -> list[int]:
    """Sprint OCR-01 heuristic stand-in: a block is a candidate medicine
    line if it has any digit-or-letter content and confidence above a
    low floor — real heuristics land in a later sprint (CR-001 §2).
    """
    return [i for i, b in enumerate(blocks) if b.raw_text.strip() and b.confidence >= 0.5]
