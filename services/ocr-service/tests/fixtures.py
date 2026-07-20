"""Synthetic image fixtures for the Sprint OCR-02 preprocessing tests —
built programmatically (not sample files) so every scenario is
reproducible and the effect under test (blur, rotation, brightness,
noise, ...) is applied under our own control.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def _document_canvas(width: int = 900, height: int = 1200) -> Image.Image:
    """A synthetic "prescription" — white background, black ruled lines
    and blocks standing in for handwriting/print, sharp edges."""
    img = Image.new("L", (width, height), color=250)
    draw = ImageDraw.Draw(img)
    for y in range(80, height - 80, 60):
        draw.line([(60, y), (width - 60, y)], fill=20, width=3)
    for i in range(6):
        x0 = 90 + i * 40
        draw.rectangle([x0, 40, x0 + 20, 60], fill=10)
    draw.rectangle([40, 20, width - 40, height - 20], outline=0, width=4)
    return img.convert("RGB")


def sharp_document_bytes() -> bytes:
    return _to_png_bytes(_document_canvas())


def blurry_document_bytes() -> bytes:
    img = _document_canvas().filter(ImageFilter.GaussianBlur(radius=8))
    return _to_png_bytes(img)


def rotated_document_bytes(degrees: float = 12.0) -> bytes:
    img = _document_canvas().rotate(degrees, expand=True, fillcolor=(250, 250, 250))
    return _to_png_bytes(img)


def dark_document_bytes() -> bytes:
    arr = np.array(_document_canvas()).astype(np.float32) * 0.25
    return _to_png_bytes(Image.fromarray(arr.astype(np.uint8)))


def bright_document_bytes() -> bytes:
    arr = np.array(_document_canvas()).astype(np.float32)
    arr = 255 - (255 - arr) * 0.15
    return _to_png_bytes(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)))


def noisy_document_bytes() -> bytes:
    rng = np.random.default_rng(42)
    arr = np.array(_document_canvas()).astype(np.float32)
    noise = rng.normal(0, 35, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return _to_png_bytes(Image.fromarray(arr))


def cropped_scene_bytes() -> bytes:
    """A document photographed on a larger, darker background — exercises
    edge-detection/auto-crop, unlike the other fixtures which are already
    frame-filling."""
    doc = _document_canvas(700, 900)
    scene = Image.new("RGB", (1200, 1500), color=(40, 40, 45))
    scene.paste(doc, (250, 300))
    return _to_png_bytes(scene)


def low_resolution_document_bytes() -> bytes:
    img = _document_canvas(140, 180)
    return _to_png_bytes(img)


def multi_page_pdf_bytes(pages: int = 2) -> bytes:
    images = [_document_canvas(600, 800) for _ in range(pages)]
    buf = io.BytesIO()
    images[0].save(buf, format="PDF", save_all=True, append_images=images[1:])
    return buf.getvalue()


def _to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
