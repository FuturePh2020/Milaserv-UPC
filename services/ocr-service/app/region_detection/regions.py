"""Prescription Region Detector (design doc: detect candidates → score →
select the best → never silently discard the rest).

Fully proportional to the image's own dimensions — no fixed pixel
coordinates anywhere in this module, so it generalizes across devices and
resolutions (design doc: "screenshots may come from different devices
and resolutions").
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import RegionDetectionConfig

#: A candidate touching the top/bottom of the frame within this fraction
#: of image height is treated as likely chrome (status bar / nav bar),
#: not content — proportional, not a fixed pixel band.
EDGE_ZONE_FRACTION = 0.08


@dataclass
class RegionCandidate:
    region_index: int
    x: int
    y: int
    width: int
    height: int
    confidence: float
    region_type: str


def _content_density(gray_region: np.ndarray) -> float:
    """Fraction of edge pixels inside the region — text/line content
    scores high, a near-blank chat bubble or a flat profile-picture
    background scores low."""
    if gray_region.size == 0:
        return 0.0
    edges = cv2.Canny(gray_region, 50, 150)
    return float(np.count_nonzero(edges)) / float(edges.size)


def _rectangularity(contour: np.ndarray, bbox_area: float) -> float:
    contour_area = cv2.contourArea(contour)
    if bbox_area <= 0:
        return 0.0
    return min(1.0, contour_area / bbox_area)


def _position_score(y: int, height: int, image_height: int) -> float:
    """Penalizes candidates that sit entirely inside the top/bottom edge
    zone (status bar, nav bar, app chrome) — proportional to the image's
    own height, never a fixed pixel offset."""
    edge_zone = image_height * EDGE_ZONE_FRACTION
    if y + height <= edge_zone or y >= image_height - edge_zone:
        return 0.1
    return 1.0


def detect_candidate_regions(img: np.ndarray, config: RegionDetectionConfig) -> list[RegionCandidate]:
    height, width = img.shape[:2]
    image_area = float(height * width)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img

    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    scored: list[RegionCandidate] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        bbox_area = float(w * h)
        area_ratio = bbox_area / image_area if image_area else 0.0
        if area_ratio < config.min_region_area_ratio or area_ratio > 0.98:
            continue

        rect_score = _rectangularity(contour, bbox_area)
        pos_score = _position_score(y, h, height)
        density = _content_density(gray[y : y + h, x : x + w])
        # A healthy prescription region has real internal structure
        # (ruled lines, handwriting, print) — neither a blank field nor
        # visual noise.
        density_score = 1.0 if 0.02 <= density <= 0.45 else max(0.0, 1.0 - abs(density - 0.2) / 0.5)
        area_score = min(1.0, area_ratio / 0.5)

        confidence = round(
            0.30 * area_score + 0.25 * rect_score + 0.25 * density_score + 0.20 * pos_score, 3
        )
        scored.append(
            RegionCandidate(
                region_index=-1,
                x=x,
                y=y,
                width=w,
                height=h,
                confidence=confidence,
                region_type="document",
            )
        )

    scored.sort(key=lambda r: r.confidence, reverse=True)
    deduped = _drop_nested_duplicates(scored)

    if not deduped:
        # No separable sub-region found (design doc: "must not assume the
        # entire image is a prescription" — but with nothing else to go
        # on, the whole frame is the only honest fallback). Moderate
        # confidence keeps it below the default accept threshold so a
        # human still confirms it.
        deduped = [
            RegionCandidate(
                region_index=-1,
                x=0,
                y=0,
                width=width,
                height=height,
                confidence=0.5,
                region_type="full_image_fallback",
            )
        ]

    capped = deduped[: config.max_candidates]
    for i, candidate in enumerate(capped):
        candidate.region_index = i
    return capped


def _drop_nested_duplicates(candidates: list[RegionCandidate], iou_threshold: float = 0.75) -> list[RegionCandidate]:
    """Canny/contour detection on real images routinely yields many
    near-identical boxes around the same content — keep only the
    highest-confidence one per overlapping cluster."""
    kept: list[RegionCandidate] = []
    for c in candidates:
        if any(_iou(c, k) > iou_threshold for k in kept):
            continue
        kept.append(c)
    return kept


def _iou(a: RegionCandidate, b: RegionCandidate) -> float:
    ax2, ay2 = a.x + a.width, a.y + a.height
    bx2, by2 = b.x + b.width, b.y + b.height
    ix1, iy1 = max(a.x, b.x), max(a.y, b.y)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    intersection = (ix2 - ix1) * (iy2 - iy1)
    union = a.width * a.height + b.width * b.height - intersection
    return intersection / union if union > 0 else 0.0


def select_best_region(candidates: list[RegionCandidate]) -> RegionCandidate | None:
    if not candidates:
        return None
    return max(candidates, key=lambda r: r.confidence)
