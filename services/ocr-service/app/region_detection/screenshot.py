"""Screenshot-aware detection — generic signals only (design doc: "Do not
rely on fixed pixel coordinates ... Use visual region detection, document
boundary detection, contour analysis, and configurable heuristics").

Every threshold here is resolution-independent (a fraction of the image's
own dimensions), so it generalizes across devices instead of hard-coding
one phone's screen layout.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import RegionDetectionConfig

#: Top-strip sample band, as a fraction of image height — wide enough to
#: catch a status bar + app header together, on any device.
BAND_FRACTION = 0.10
#: A band counts as "chrome" (status bar / nav bar / app header) if its
#: row-to-row color variance is below this — solid-ish banners, unlike
#: continuous photographic content.
CHROME_VARIANCE_THRESHOLD = 180.0

#: Known WhatsApp header/bubble reference colors (light + dark mode,
#: Android + iOS, old + new brand palette) — a secondary hint only, never
#: the sole basis for classification (design doc: "optional WhatsApp-
#: specific heuristics as secondary signals only").
WHATSAPP_REFERENCE_COLORS_BGR = [
    (84, 94, 7),  # #075E54 dark teal (BGR) — classic header, both themes
    (126, 140, 18),  # #128C7E
    (75, 92, 0),  # #005C4B newer dark-mode green
    (105, 128, 0),  # #008069 current-generation brand green
]
WHATSAPP_COLOR_TOLERANCE = 45.0


@dataclass
class ScreenshotDetection:
    is_screenshot: bool
    confidence: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class WhatsAppHint:
    hint: str | None
    confidence: float


def _band_variance(band: np.ndarray) -> float:
    if band.size == 0:
        return 0.0
    row_means = band.reshape(band.shape[0], -1, band.shape[-1]).mean(axis=1)
    return float(np.mean(np.var(row_means, axis=0)))


#: A band only counts as "chrome" if its mean color also differs from the
#: page's own content area by at least this much (Euclidean, 0-255 per
#: channel) — a blank white margin on a scanned page is low-variance too,
#: but it's the *same* tone as the rest of the page, unlike a colored
#: status bar / app header sitting on top of different content.
CHROME_COLOR_DISTANCE_THRESHOLD = 30.0


def _is_chrome_band(band: np.ndarray, content: np.ndarray) -> bool:
    if band.size == 0 or content.size == 0:
        return False
    if _band_variance(band) >= CHROME_VARIANCE_THRESHOLD:
        return False
    band_mean = band.reshape(-1, band.shape[-1]).mean(axis=0)
    content_mean = content.reshape(-1, content.shape[-1]).mean(axis=0)
    distance = float(np.linalg.norm(band_mean - content_mean))
    return distance >= CHROME_COLOR_DISTANCE_THRESHOLD


def detect_screenshot(
    img: np.ndarray, has_camera_exif: bool, config: RegionDetectionConfig
) -> ScreenshotDetection:
    height, width = img.shape[:2]
    aspect_ratio = height / width if width else 0
    reasons: list[str] = []
    score = 0.0

    # Weighted so aspect ratio + missing EXIF alone (0.25 + 0.10 = 0.35)
    # can never cross the 0.5 threshold on their own — a portrait photo
    # with its EXIF stripped is not enough; real chrome-band evidence is
    # required too.
    aspect_plausible = config.screenshot_aspect_ratio_min <= aspect_ratio <= config.screenshot_aspect_ratio_max
    if aspect_plausible:
        score += 0.25
        reasons.append(f"aspect_ratio {aspect_ratio:.2f} within phone-screenshot band")

    band_h = max(1, int(height * BAND_FRACTION))
    top_band = img[0:band_h, :]
    bottom_band = img[height - band_h : height, :]
    # The middle 60% stands in for "the page's own content" — what a
    # chrome band's color gets compared against.
    mid_start, mid_end = int(height * 0.2), int(height * 0.8)
    content = img[mid_start:mid_end, :]

    if _is_chrome_band(top_band, content):
        score += 0.35
        reasons.append("top band is low-variance and color-distinct from the content (status bar / header)")
    if _is_chrome_band(bottom_band, content):
        score += 0.3
        reasons.append("bottom band is low-variance and color-distinct from the content (nav bar / input bar)")

    if not has_camera_exif:
        score += 0.10
        reasons.append("no camera EXIF metadata")
    else:
        score -= 0.3
        reasons.append("camera EXIF metadata present (photo, not screenshot)")

    score = max(0.0, min(1.0, score))
    return ScreenshotDetection(is_screenshot=score >= 0.5, confidence=round(score, 3), reasons=reasons)


def detect_whatsapp_hint(img: np.ndarray, config: RegionDetectionConfig) -> WhatsAppHint:
    """Secondary signal only — a color-band match, never a layout parse.
    Deliberately tolerant so it survives WhatsApp UI/theme changes; a
    caller should never rely on this alone (design doc §"WhatsApp
    Screenshot Handling")."""
    if not config.whatsapp_hint_enabled:
        return WhatsAppHint(hint=None, confidence=0.0)

    height, width = img.shape[:2]
    band_h = max(1, int(height * BAND_FRACTION))
    top_band = img[0:band_h, :]
    mean_color = top_band.reshape(-1, top_band.shape[-1]).mean(axis=0)

    best_distance = min(
        float(np.linalg.norm(mean_color - np.array(ref, dtype=np.float64)))
        for ref in WHATSAPP_REFERENCE_COLORS_BGR
    )
    if best_distance <= WHATSAPP_COLOR_TOLERANCE:
        confidence = round(max(0.0, 1.0 - best_distance / WHATSAPP_COLOR_TOLERANCE) * 0.6, 3)
        return WhatsAppHint(hint="whatsapp", confidence=confidence)
    return WhatsAppHint(hint=None, confidence=0.0)
