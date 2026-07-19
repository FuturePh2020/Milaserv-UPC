"""Sprint OCR-02 pipeline orchestrator — the 18 numbered steps in the
design spec, run in order, each individually toggleable via
PreprocessingConfig. Produces image versions (Original/Rotated/Cropped/
Enhanced/OCR-ready) as bytes plus the 0-100 quality score; never touches
storage or the DB — the caller (main.py, then NestJS) owns persistence.

No OCR text recognition happens here (design spec: "must not perform OCR
text extraction yet") — this module only ever looks at pixels.
"""

from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass, field

import cv2
import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageOps

from .config import PreprocessingConfig
from . import steps

logger = logging.getLogger("ocr_service.preprocessing")

#: Aggregate quality-score weights — sum to 1.0 across whichever
#: processors are enabled (disabled ones are excluded and the rest
#: renormalized, so the score always stays meaningful).
SCORE_WEIGHTS = {
    "resolution": 0.15,
    "blur": 0.20,
    "brightness": 0.15,
    "contrast": 0.15,
    "noise": 0.15,
    "rotation": 0.10,
    "crop": 0.05,
    "readableArea": 0.05,
}


@dataclass
class ImageVersion:
    version_type: str
    image_bytes: bytes
    width: int
    height: int
    format: str = "PNG"


@dataclass
class PagePreprocessResult:
    quality_score: float
    quality_status: str
    metrics: dict
    versions: dict[str, ImageVersion] = field(default_factory=dict)
    stages_applied: list[str] = field(default_factory=list)
    processor_timings_ms: dict[str, int] = field(default_factory=dict)
    processor_failures: list[str] = field(default_factory=list)


@dataclass
class PreprocessingResult:
    pages: list[PagePreprocessResult]
    page_count: int
    processing_duration_ms: int

    @property
    def primary(self) -> PagePreprocessResult:
        return self.pages[0]


def _encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("failed to encode image")
    return bytes(buf)


def _timed(name: str, timings: dict[str, int], fn, *args):
    started = time.monotonic()
    result = fn(*args)
    timings[name] = int((time.monotonic() - started) * 1000)
    return result


def _load_images_from_bytes(data: bytes) -> list[tuple[np.ndarray, int]]:
    """Returns a list of (BGR numpy array, exif_rotation_degrees) — one
    entry per page for a PDF, or a single entry for a plain image."""
    if data[:5] == b"%PDF-":
        doc = fitz.open(stream=data, filetype="pdf")
        pages = []
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
            pages.append((arr, 0))
        doc.close()
        if not pages:
            raise ValueError("PDF has no pages")
        return pages

    pil_img = Image.open(io.BytesIO(data))
    exif_degrees = 0
    try:
        exif = pil_img.getexif()
        orientation_tag = 274  # PIL ExifTags.Base.Orientation
        raw = exif.get(orientation_tag)
        exif_degrees = {3: 180, 6: 270, 8: 90}.get(raw, 0)
    except Exception:  # noqa: BLE001 — EXIF is best-effort metadata
        pass
    pil_img = ImageOps.exif_transpose(pil_img)
    if pil_img.mode not in ("RGB", "L"):
        pil_img = pil_img.convert("RGB")
    arr = np.array(pil_img)
    if arr.ndim == 3:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    return [(arr, exif_degrees)]


def _process_single_page(img: np.ndarray, exif_degrees: int, config: PreprocessingConfig) -> PagePreprocessResult:
    stages_applied: list[str] = []
    timings: dict[str, int] = {}
    failures: list[str] = []
    metrics: dict = {}
    versions: dict[str, ImageVersion] = {}

    def run_step(name: str, fn, *args):
        try:
            return _timed(name, timings, fn, *args)
        except Exception as exc:  # noqa: BLE001 — one bad processor must not sink the pipeline
            logger.warning("preprocessing step %s failed: %s", name, exc)
            failures.append(f"{name}: {exc}")
            return None

    height, width = img.shape[:2]
    resolution_ok = width >= config.min_image_width and height >= config.min_image_height
    if config.is_enabled("validation"):
        stages_applied.append("validation")
        if not resolution_ok:
            failures_note = f"resolution {width}x{height} below minimum {config.min_image_width}x{config.min_image_height}"
            logger.info(failures_note)
    metrics["resolutionOk"] = resolution_ok
    metrics["width"] = width
    metrics["height"] = height

    working = img
    rotation_angle = 0.0

    if config.is_enabled("orientationDetection"):
        rotation_angle = run_step("orientationDetection", steps.detect_orientation, working, exif_degrees) or 0.0
        stages_applied.append("orientationDetection")

    if config.is_enabled("autoRotation") and rotation_angle:
        rotated = run_step("autoRotation", steps.rotate_image, working, rotation_angle)
        if rotated is not None:
            working = rotated
            stages_applied.append("autoRotation")
            versions["ROTATED"] = ImageVersion("ROTATED", _encode_png(working), working.shape[1], working.shape[0])

    gray_for_skew = steps.to_gray(working)
    skew = run_step("skewDetection", steps.detect_skew_angle, gray_for_skew, config.max_rotation_degrees) or 0.0
    if config.is_enabled("autoRotation") and abs(skew) >= 0.5:
        deskewed = run_step("autoRotation.deskew", steps.rotate_image, working, skew)
        if deskewed is not None:
            working = deskewed
            rotation_angle += skew
            if "ROTATED" not in versions:
                versions["ROTATED"] = ImageVersion("ROTATED", _encode_png(working), working.shape[1], working.shape[0])
    metrics["rotationAngle"] = round(rotation_angle, 2)

    gray = steps.to_gray(working)

    blur_variance, blur_score = (0.0, 1.0)
    if config.is_enabled("blurDetection"):
        result = run_step("blurDetection", steps.detect_blur, gray)
        if result is not None:
            blur_variance, blur_score = result
            stages_applied.append("blurDetection")
    metrics["blurScore"] = round(blur_score, 3)
    metrics["blurVariance"] = round(blur_variance, 2)

    brightness_mean, brightness_score = (127.5, 1.0)
    if config.is_enabled("brightnessAnalysis"):
        result = run_step("brightnessAnalysis", steps.analyze_brightness, gray)
        if result is not None:
            brightness_mean, brightness_score = result
            stages_applied.append("brightnessAnalysis")
    metrics["brightnessScore"] = round(brightness_score, 3)
    metrics["brightnessMean"] = round(brightness_mean, 2)

    contrast_std, contrast_score = (steps.CONTRAST_REFERENCE, 1.0)
    if config.is_enabled("contrastAnalysis"):
        result = run_step("contrastAnalysis", steps.analyze_contrast, gray, config.min_contrast)
        if result is not None:
            contrast_std, contrast_score = result
            stages_applied.append("contrastAnalysis")
    metrics["contrastScore"] = round(contrast_score, 3)
    metrics["contrastStdDev"] = round(contrast_std, 2)

    noise_level, noise_score = (0.0, 1.0)
    if config.is_enabled("noiseEstimation"):
        result = run_step("noiseEstimation", steps.estimate_noise, gray, config.max_noise)
        if result is not None:
            noise_level, noise_score = result
            stages_applied.append("noiseEstimation")
    metrics["noiseScore"] = round(noise_score, 3)
    metrics["noiseLevel"] = round(noise_level, 2)

    quad = None
    if config.is_enabled("edgeDetection") or config.is_enabled("perspectiveCorrection") or config.is_enabled("autoCrop"):
        quad = run_step("edgeDetection", steps.find_document_contour, gray)
        if quad is not None:
            stages_applied.append("edgeDetection")
    crop_confidence = steps.crop_confidence_from_contour(gray.shape, quad)
    metrics["cropConfidence"] = crop_confidence

    if config.is_enabled("perspectiveCorrection") and quad is not None:
        warped = run_step("perspectiveCorrection", steps.warp_perspective, working, quad)
        if warped is not None and warped.size > 0:
            working = warped
            stages_applied.append("perspectiveCorrection")
            versions["CROPPED"] = ImageVersion("CROPPED", _encode_png(working), working.shape[1], working.shape[0])
    elif config.is_enabled("autoCrop"):
        gray_now = steps.to_gray(working)
        cropped = run_step("autoCrop", steps.auto_crop, working, gray_now)
        if cropped is not None and cropped.size > 0 and cropped.shape[:2] != working.shape[:2]:
            working = cropped
            stages_applied.append("autoCrop")
            versions["CROPPED"] = ImageVersion("CROPPED", _encode_png(working), working.shape[1], working.shape[0])

    enhanced_gray = steps.to_gray(working)
    if config.is_enabled("shadowRemoval"):
        result = run_step("shadowRemoval", steps.remove_shadow, enhanced_gray)
        if result is not None:
            enhanced_gray = result
            stages_applied.append("shadowRemoval")
    if config.is_enabled("backgroundCleanup"):
        # Background cleanup produces a near-binary working copy used only
        # to inform readable-area scoring — the enhanced version keeps the
        # shadow-corrected grayscale so contrast/sharpen still have real
        # tonal range to work with.
        cleaned = run_step("backgroundCleanup", steps.cleanup_background, enhanced_gray)
        if cleaned is not None:
            stages_applied.append("backgroundCleanup")
    if config.is_enabled("contrastEnhancement"):
        result = run_step("contrastEnhancement", steps.enhance_contrast, enhanced_gray)
        if result is not None:
            enhanced_gray = result
            stages_applied.append("contrastEnhancement")
    if config.is_enabled("sharpening"):
        result = run_step("sharpening", steps.sharpen, enhanced_gray)
        if result is not None:
            enhanced_gray = result
            stages_applied.append("sharpening")

    if config.is_enabled("grayscale"):
        stages_applied.append("grayscale")
    versions["ENHANCED"] = ImageVersion("ENHANCED", _encode_png(enhanced_gray), enhanced_gray.shape[1], enhanced_gray.shape[0])

    ocr_ready = enhanced_gray
    if config.is_enabled("binarization"):
        result = run_step("binarization", steps.binarize, enhanced_gray)
        if result is not None:
            ocr_ready = result
            stages_applied.append("binarization")
    readable_area = steps.readable_area_ratio(ocr_ready) if ocr_ready.dtype == np.uint8 else 0.0
    metrics["readableArea"] = readable_area
    versions["OCR_READY"] = ImageVersion("OCR_READY", _encode_png(ocr_ready), ocr_ready.shape[1], ocr_ready.shape[0])

    quality_score, quality_status = _score(metrics, config, resolution_ok)

    return PagePreprocessResult(
        quality_score=quality_score,
        quality_status=quality_status,
        metrics=metrics,
        versions=versions,
        stages_applied=stages_applied,
        processor_timings_ms=timings,
        processor_failures=failures,
    )


def _readable_area_subscore(ratio: float) -> float:
    # A healthy prescription page is typically 3-25% ink coverage; too
    # little suggests a blank/near-empty scan, too much suggests a solid
    # dark blob (failed threshold, not real content).
    if 0.02 <= ratio <= 0.35:
        return 1.0
    if ratio < 0.02:
        return max(0.0, ratio / 0.02)
    return max(0.0, 1.0 - (ratio - 0.35) / 0.65)


def _score(metrics: dict, config: PreprocessingConfig, resolution_ok: bool) -> tuple[float, str]:
    subscores = {
        "resolution": 1.0 if resolution_ok else 0.2,
        "blur": metrics.get("blurScore", 1.0),
        "brightness": metrics.get("brightnessScore", 1.0),
        "contrast": metrics.get("contrastScore", 1.0),
        "noise": metrics.get("noiseScore", 1.0),
        "rotation": max(0.0, 1.0 - abs(metrics.get("rotationAngle", 0.0)) / max(config.max_rotation_degrees, 1)),
        "crop": metrics.get("cropConfidence", 1.0) if config.is_enabled("autoCrop") or config.is_enabled("perspectiveCorrection") else 1.0,
        "readableArea": _readable_area_subscore(metrics.get("readableArea", 0.1)),
    }
    enabled_map = {
        "resolution": config.is_enabled("validation"),
        "blur": config.is_enabled("blurDetection"),
        "brightness": config.is_enabled("brightnessAnalysis"),
        "contrast": config.is_enabled("contrastAnalysis"),
        "noise": config.is_enabled("noiseEstimation"),
        "rotation": config.is_enabled("orientationDetection") or config.is_enabled("autoRotation"),
        "crop": config.is_enabled("autoCrop") or config.is_enabled("perspectiveCorrection"),
        "readableArea": config.is_enabled("binarization"),
    }
    active = {k: w for k, w in SCORE_WEIGHTS.items() if enabled_map.get(k, True)}
    total_weight = sum(active.values()) or 1.0
    score = sum(subscores[k] * (w / total_weight) for k, w in active.items())
    score_100 = round(max(0.0, min(1.0, score)) * 100, 1)

    if score_100 < config.min_quality_score:
        status = "REUPLOAD_REQUIRED"
    elif score_100 < max(config.min_quality_score, 50):
        status = "POOR"
    elif score_100 < 70:
        status = "FAIR"
    elif score_100 < 85:
        status = "GOOD"
    else:
        status = "EXCELLENT"
    return score_100, status


def run_preprocessing(image_bytes: bytes, config: PreprocessingConfig) -> PreprocessingResult:
    started = time.monotonic()
    raw_pages = _load_images_from_bytes(image_bytes)
    if len(raw_pages) > 1:
        logger.info("multi-page PDF: %d pages rasterized for quality analysis", len(raw_pages))
    pages = [_process_single_page(img, exif_deg, config) for img, exif_deg in raw_pages]
    duration_ms = int((time.monotonic() - started) * 1000)
    return PreprocessingResult(pages=pages, page_count=len(pages), processing_duration_ms=duration_ms)
