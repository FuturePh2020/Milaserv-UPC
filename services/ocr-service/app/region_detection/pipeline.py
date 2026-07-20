"""Orchestrates screenshot detection + candidate-region detection into
one result (design doc: "Prescription Region Detector"). No OCR or text
recognition happens here — pixels and geometry only.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field

import cv2
import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageOps

from .config import RegionDetectionConfig
from .regions import RegionCandidate, detect_candidate_regions, select_best_region
from .screenshot import ScreenshotDetection, WhatsAppHint, detect_screenshot, detect_whatsapp_hint

logger = logging.getLogger("ocr_service.region_detection")

#: EXIF tag ids (PIL ExifTags.Base) that indicate a real camera capture.
_EXIF_MAKE = 271
_EXIF_MODEL = 272

#: Paper aspect ratios (height/width, portrait) a scanner is likely to
#: produce — a soft heuristic, not a hard classifier.
_SCAN_ASPECT_RATIOS = [1.414, 1.294, 1.5]
_SCAN_ASPECT_TOLERANCE = 0.08


@dataclass
class RegionDetectionResult:
    source_type_hint: str
    screenshot_detected: bool
    screenshot_confidence: float
    screenshot_application_hint: str | None
    original_width: int
    original_height: int
    regions: list[RegionCandidate] = field(default_factory=list)
    best_region_index: int | None = None
    manual_crop_required: bool = True


def _has_camera_exif(pil_img: Image.Image) -> bool:
    try:
        exif = pil_img.getexif()
    except Exception:  # noqa: BLE001 — EXIF is best-effort metadata
        return False
    return bool(exif.get(_EXIF_MAKE) or exif.get(_EXIF_MODEL))


def _looks_like_scan(width: int, height: int) -> bool:
    if width <= 0 or height <= 0:
        return False
    ratio = max(width, height) / min(width, height)
    return any(abs(ratio - r) <= _SCAN_ASPECT_TOLERANCE for r in _SCAN_ASPECT_RATIOS)


def _pil_to_bgr(pil_img: Image.Image) -> np.ndarray:
    pil_img = ImageOps.exif_transpose(pil_img)
    if pil_img.mode not in ("RGB", "L"):
        pil_img = pil_img.convert("RGB")
    arr = np.array(pil_img)
    if arr.ndim == 3:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    else:
        arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    return arr


def detect(image_bytes: bytes, config: RegionDetectionConfig) -> RegionDetectionResult:
    if image_bytes[:5] == b"%PDF-":
        doc = fitz.open(stream=image_bytes, filetype="pdf")
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        height, width = pix.height, pix.width
        doc.close()
        return RegionDetectionResult(
            source_type_hint="PDF",
            screenshot_detected=False,
            screenshot_confidence=0.0,
            screenshot_application_hint=None,
            original_width=width,
            original_height=height,
            regions=[
                RegionCandidate(0, 0, 0, width, height, confidence=1.0, region_type="pdf_page")
            ],
            best_region_index=0,
            manual_crop_required=False,
        )

    pil_img = Image.open(io.BytesIO(image_bytes))
    original_width, original_height = pil_img.size
    has_camera_exif = _has_camera_exif(pil_img)
    img = _pil_to_bgr(pil_img)

    if not config.enabled:
        return RegionDetectionResult(
            source_type_hint="UNKNOWN",
            screenshot_detected=False,
            screenshot_confidence=0.0,
            screenshot_application_hint=None,
            original_width=original_width,
            original_height=original_height,
            regions=[],
            best_region_index=None,
            manual_crop_required=True,
        )

    screenshot: ScreenshotDetection = detect_screenshot(img, has_camera_exif, config)
    whatsapp: WhatsAppHint = (
        detect_whatsapp_hint(img, config)
        if screenshot.is_screenshot
        else WhatsAppHint(hint=None, confidence=0.0)
    )

    regions = detect_candidate_regions(img, config)
    best = select_best_region(regions)

    if screenshot.is_screenshot and whatsapp.hint == "whatsapp":
        source_type = "WHATSAPP_SCREENSHOT"
    elif screenshot.is_screenshot:
        source_type = "SCREENSHOT"
    elif has_camera_exif:
        source_type = "CAMERA"
    elif _looks_like_scan(original_width, original_height):
        source_type = "SCANNER"
    else:
        source_type = "UNKNOWN"

    manual_crop_required = best is None or best.confidence < config.min_confidence

    return RegionDetectionResult(
        source_type_hint=source_type,
        screenshot_detected=screenshot.is_screenshot,
        screenshot_confidence=screenshot.confidence,
        screenshot_application_hint=whatsapp.hint,
        original_width=original_width,
        original_height=original_height,
        regions=regions,
        best_region_index=best.region_index if best else None,
        manual_crop_required=manual_crop_required,
    )
