"""Synthetic fixtures for the region-detection test suite — built
programmatically (no real WhatsApp/device screenshots are used or
fabricated) so every scenario exercises the actual geometric/heuristic
logic under our own control, the same approach tests/fixtures.py uses
for the Sprint OCR-02 preprocessing suite.
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

# WhatsApp reference colors (RGB, matching the BGR list in
# app/region_detection/screenshot.py).
WHATSAPP_DARK_HEADER = (7, 94, 84)  # #075E54
WHATSAPP_DARKER_HEADER = (0, 92, 75)  # #005C4B
# Real WhatsApp keeps a colored header in both themes — only the chat
# background changes between light/dark mode, not the app bar itself.
WHATSAPP_LIGHT_HEADER = (0, 128, 105)  # #008069 current-generation green
CHAT_BG_LIGHT = (236, 229, 221)  # #ECE5DD
CHAT_BG_DARK = (18, 27, 33)  # #121B21


def _document_bubble(width: int, height: int) -> Image.Image:
    """A synthetic "prescription photo" — reused as the content inside a
    chat bubble/gallery slot, same ruled-line style as the OCR-02 suite's
    fixtures.py so region detection has real internal structure to find."""
    img = Image.new("RGB", (width, height), (250, 250, 250))
    draw = ImageDraw.Draw(img)
    for y in range(int(height * 0.1), int(height * 0.9), max(8, height // 20)):
        draw.line([(int(width * 0.08), y), (int(width * 0.92), y)], fill=(20, 20, 20), width=2)
    draw.rectangle([4, 4, width - 4, height - 4], outline=(0, 0, 0), width=2)
    return img


def _to_bytes(img: Image.Image, exif: bytes | None = None) -> bytes:
    buf = io.BytesIO()
    if exif:
        img.save(buf, format="JPEG", exif=exif)
    else:
        img.save(buf, format="PNG")
    return buf.getvalue()


def _whatsapp_screenshot(
    width: int, height: int, header_color: tuple, bg_color: tuple, bubble_box: tuple | None = None
) -> Image.Image:
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    status_h = int(height * 0.035)
    header_h = int(height * 0.075)
    input_h = int(height * 0.07)
    draw.rectangle([0, 0, width, status_h + header_h], fill=header_color)
    draw.rectangle([0, height - input_h, width, height], fill=header_color)

    if bubble_box is None:
        bx0, by0 = int(width * 0.1), int(height * 0.25)
        bx1, by1 = int(width * 0.9), int(height * 0.75)
    else:
        bx0, by0, bx1, by1 = bubble_box
    bubble = _document_bubble(bx1 - bx0, by1 - by0)
    img.paste(bubble, (bx0, by0))
    return img


def android_whatsapp_screenshot_bytes() -> bytes:
    return _to_bytes(_whatsapp_screenshot(1080, 2280, WHATSAPP_DARK_HEADER, CHAT_BG_LIGHT))


def iphone_whatsapp_screenshot_bytes() -> bytes:
    return _to_bytes(_whatsapp_screenshot(1170, 2532, WHATSAPP_DARK_HEADER, CHAT_BG_LIGHT))


def whatsapp_dark_mode_screenshot_bytes() -> bytes:
    return _to_bytes(_whatsapp_screenshot(1080, 2280, WHATSAPP_DARKER_HEADER, CHAT_BG_DARK))


def whatsapp_light_mode_screenshot_bytes() -> bytes:
    return _to_bytes(_whatsapp_screenshot(1080, 2280, WHATSAPP_LIGHT_HEADER, CHAT_BG_LIGHT))


def generic_status_bar_screenshot_bytes() -> bytes:
    """A non-WhatsApp screenshot — plain neutral gray chrome — to prove
    generic screenshot detection doesn't depend on WhatsApp colors."""
    return _to_bytes(_whatsapp_screenshot(1080, 2280, (60, 60, 65), (245, 245, 245)))


def chat_bubbles_screenshot_bytes() -> bytes:
    """Several plain (contentless) message bubbles plus one bubble that
    actually contains the document — detection should favor the
    content-bearing bubble over the flat ones."""
    width, height = 1080, 2280
    img = Image.new("RGB", (width, height), CHAT_BG_LIGHT)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, int(height * 0.11)], fill=WHATSAPP_DARK_HEADER)
    draw.rectangle([0, height - int(height * 0.07), width, height], fill=WHATSAPP_DARK_HEADER)

    # Flat text-bubble placeholders (uniform fill — low content density).
    draw.rounded_rectangle([80, 260, 620, 380], radius=24, fill=(255, 255, 255))
    draw.rounded_rectangle([80, 420, 760, 520], radius=24, fill=(255, 255, 255))

    # The bubble that actually holds the shared prescription photo.
    bubble = _document_bubble(860, 900)
    img.paste(bubble, (110, 620))

    draw.rounded_rectangle([80, 1600, 700, 1720], radius=24, fill=(255, 255, 255))
    return _to_bytes(img)


def black_border_screenshot_bytes() -> bytes:
    """Solid black letterbox bars top/bottom around the real content —
    common when a screenshot is itself re-cropped/shared oddly."""
    width, height = 1080, 2280
    img = Image.new("RGB", (width, height), (0, 0, 0))
    bubble = _document_bubble(int(width * 0.85), int(height * 0.5))
    img.paste(bubble, (int(width * 0.075), int(height * 0.3)))
    return _to_bytes(img)


def single_image_screenshot_bytes() -> bytes:
    return _to_bytes(_whatsapp_screenshot(1080, 2280, WHATSAPP_DARK_HEADER, CHAT_BG_LIGHT))


def multiple_images_screenshot_bytes() -> bytes:
    """Two distinct document-bearing regions in one screenshot (e.g. a
    shared photo gallery / two separate messages)."""
    width, height = 1080, 2280
    img = Image.new("RGB", (width, height), CHAT_BG_LIGHT)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, int(height * 0.11)], fill=WHATSAPP_DARK_HEADER)
    draw.rectangle([0, height - int(height * 0.07), width, height], fill=WHATSAPP_DARK_HEADER)

    first = _document_bubble(860, 620)
    img.paste(first, (110, 280))
    second = _document_bubble(860, 620)
    img.paste(second, (110, 1000))
    return _to_bytes(img)


def cropped_chat_screenshot_bytes() -> bytes:
    """The top chrome is missing entirely — the user screenshotted only
    part of the screen (no clean header band to key off)."""
    width, height = 1080, 1400
    img = Image.new("RGB", (width, height), CHAT_BG_LIGHT)
    bubble = _document_bubble(860, 900)
    img.paste(bubble, (110, 200))
    return _to_bytes(img)


def camera_photo_bytes() -> bytes:
    """A real-camera-shaped photo (landscape-ish, EXIF Make/Model
    present) — should never be classified as a screenshot."""
    img = _document_bubble(1600, 1200)
    exif = Image.Exif()
    exif[271] = "Samsung"
    exif[272] = "SM-G991B"
    return _to_bytes(img, exif=exif.tobytes())


def scanned_image_bytes() -> bytes:
    """A4-ish aspect ratio, no EXIF, flat/uniform background — a scanner
    heuristic fixture."""
    return _to_bytes(_document_bubble(1240, 1754))  # ~A4 at 150dpi


def low_confidence_blank_bytes() -> bytes:
    """Nothing resembling a document anywhere — a uniform, low-texture
    frame that should never be auto-accepted."""
    img = Image.new("RGB", (1080, 1080), (230, 230, 230))
    return _to_bytes(img)
