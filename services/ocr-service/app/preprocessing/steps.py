"""Individual image-processing steps (design spec: 18-step pipeline).

Each function is a pure transform on an OpenCV BGR (or grayscale) numpy
array. None of these touch the filesystem, network, or DB — the pipeline
orchestrator (pipeline.py) is the only place that owns I/O, matching the
CR-001 Python-service boundary (design spec §1/§2).
"""

from __future__ import annotations

import cv2
import numpy as np

#: Laplacian-variance reference for "acceptably sharp" — a widely used
#: rule-of-thumb (OpenCV blur-detection tutorials), not one of the
#: business thresholds the spec asks to be admin-configurable.
BLUR_VARIANCE_REFERENCE = 120.0
#: Grayscale std-dev reference for "full contrast" (0-255 scale).
CONTRAST_REFERENCE = 64.0


def to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def detect_blur(gray: np.ndarray) -> tuple[float, float]:
    """Laplacian variance → (raw_variance, normalized_score 0-1)."""
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    score = min(1.0, variance / BLUR_VARIANCE_REFERENCE)
    return variance, score


#: A scanned/photographed document's mean intensity is dominated by its
#: (light) background, not a mid-gray scene — a well-exposed page sits in
#: this band; scoring against mid-gray (127.5) would wrongly penalize
#: healthy white-paper photos.
BRIGHTNESS_GOOD_BAND = (120.0, 235.0)


def analyze_brightness(gray: np.ndarray) -> tuple[float, float]:
    """Mean intensity (0-255) → (mean, normalized_score 0-1, penalizing
    both too-dark and too-bright/blown-out relative to the healthy band)."""
    mean = float(np.mean(gray))
    low, high = BRIGHTNESS_GOOD_BAND
    if low <= mean <= high:
        score = 1.0
    elif mean < low:
        score = max(0.0, mean / low)
    else:
        score = max(0.0, 1.0 - (mean - high) / (255.0 - high))
    return mean, score


def analyze_contrast(gray: np.ndarray, min_contrast: float) -> tuple[float, float]:
    """Std-dev of intensities (0-255) → (std, normalized_score 0-1)."""
    std = float(np.std(gray))
    reference = max(CONTRAST_REFERENCE, min_contrast * 2)
    score = min(1.0, std / reference)
    return std, score


def estimate_noise(gray: np.ndarray, max_noise: float) -> tuple[float, float]:
    """Mean absolute deviation from a median-blurred version → a cheap,
    dependency-free noise proxy. (noise_level, normalized_score 0-1)."""
    denoised = cv2.medianBlur(gray, 5)
    noise = float(np.mean(np.abs(gray.astype(np.float32) - denoised.astype(np.float32))))
    score = 1.0 if max_noise <= 0 else max(0.0, 1.0 - noise / max_noise)
    return noise, score


def detect_orientation(img: np.ndarray, exif_orientation: int | None) -> int:
    """EXIF-tag-driven coarse orientation (0/90/180/270). PIL already
    normalizes the EXIF tag into "degrees to rotate" via ImageOps —
    pipeline.py passes that value straight through."""
    return exif_orientation or 0


def rotate_image(img: np.ndarray, degrees: float) -> np.ndarray:
    if degrees % 360 == 0:
        return img
    if degrees in (90, 180, 270):
        rot = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
        return cv2.rotate(img, rot[int(degrees)])
    h, w = img.shape[:2]
    center = (w / 2, h / 2)
    matrix = cv2.getRotationMatrix2D(center, -degrees, 1.0)
    return cv2.warpAffine(img, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)


def detect_skew_angle(gray: np.ndarray, max_rotation_degrees: float) -> float:
    """Residual fine-grained skew (beyond 90° multiples) via the minimum
    bounding rectangle of the foreground mask. Returns 0 if no reliable
    foreground contour was found, or if the detected skew exceeds the
    configured tolerance (treated as noise, not a real rotation)."""
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(thresh)
    if coords is None or len(coords) < 50:
        return 0.0
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) > max_rotation_degrees:
        return 0.0
    return round(float(angle), 2)


def find_document_contour(gray: np.ndarray) -> np.ndarray | None:
    """Largest 4-point (quadrilateral) contour — a candidate document/page
    boundary for perspective correction and cropping."""
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    area_ratio = cv2.contourArea(largest) / (gray.shape[0] * gray.shape[1])
    if area_ratio < 0.15:
        return None
    peri = cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, 0.02 * peri, True)
    if len(approx) == 4:
        return approx.reshape(4, 2).astype(np.float32)
    return None


def order_quad_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def warp_perspective(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    rect = order_quad_points(quad)
    (tl, tr, br, bl) = rect
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    width, height = max(width, 1), max(height, 1)
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, matrix, (width, height))


def crop_confidence_from_contour(gray_shape: tuple[int, int], quad: np.ndarray | None) -> float:
    if quad is None:
        return 0.0
    area = cv2.contourArea(quad.astype(np.float32))
    ratio = area / (gray_shape[0] * gray_shape[1])
    return round(min(1.0, ratio / 0.5), 3)


def auto_crop(img: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """Fallback crop (no clean quadrilateral): bounding box of the
    largest contour, with a small margin."""
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return img
    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)
    if w * h < 0.1 * gray.shape[0] * gray.shape[1]:
        return img
    margin = 10
    x0, y0 = max(0, x - margin), max(0, y - margin)
    x1, y1 = min(img.shape[1], x + w + margin), min(img.shape[0], y + h + margin)
    return img[y0:y1, x0:x1]


def cleanup_background(gray: np.ndarray) -> np.ndarray:
    """Adaptive threshold + morphological opening — suppresses speckle
    background outside the text region while keeping strokes intact."""
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )
    kernel = np.ones((2, 2), np.uint8)
    return cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)


def remove_shadow(gray: np.ndarray) -> np.ndarray:
    """Classic dilate + median-blur background estimate, then normalize —
    flattens uneven illumination/shadows without a deep model."""
    dilated = cv2.dilate(gray, np.ones((7, 7), np.uint8))
    bg = cv2.medianBlur(dilated, 21)
    diff = 255 - cv2.absdiff(gray, bg)
    return cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)


def enhance_contrast(gray: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def sharpen(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, (0, 0), 3)
    return cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)


def binarize(gray: np.ndarray) -> np.ndarray:
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def readable_area_ratio(binary: np.ndarray) -> float:
    """Foreground (ink) pixel fraction — a very low or very high ratio
    both indicate a low-content or over-thresholded page."""
    foreground = float(np.count_nonzero(binary == 0))
    total = float(binary.size) or 1.0
    return round(foreground / total, 4)
