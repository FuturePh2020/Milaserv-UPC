"""Synthetic OCR evaluation fixtures — CR-001 Sprint OCR-03 design brief
§19 ("Evaluation Dataset"). Every image is rendered programmatically from
a known ground-truth string with a known system font — never a real
customer prescription or any PII, per the brief's explicit requirement
("synthetic/anonymized data only").

English uses DejaVu Sans; Arabic uses FreeSerif (the same font already
relied on by tests/test_paddleocr_provider.py's glyph fixtures, and the
one Sprint OCR-03's Dockerfile installs via fonts-dejavu-core /
fonts-freefont — both ship on Debian-family images without any network
fetch). PIL does not perform Arabic shaping/joining, so rendered glyphs
are isolated forms rather than a typeset word — acceptable here because
this dataset exercises character/word-level recognition accuracy, not
visual typesetting fidelity; it is not a substitute for testing against
real handwriting or real prescription photos.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
IMAGES_DIR = HERE / "images"
MANIFEST_PATH = HERE / "manifest.json"

ENGLISH_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
ARABIC_FONT = "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"

# (id, ground-truth text, category) — categories are informational only,
# used to group results in the report, never to change scoring.
ENGLISH_FIXTURES = [
    ("en-01", "Panadol Extra Tab", "printed"),
    ("en-02", "Augmentin 1 gm twice daily", "printed"),
    ("en-03", "Amoxicillin 500mg", "printed"),
    ("en-04", "Take two tablets after meals", "printed"),
    ("en-05", "Paracetamol 500 mg", "printed_small"),
]

ARABIC_FIXTURES = [
    ("ar-01", "باندول اكسترا", "printed"),
    ("ar-02", "أموكسيسيلين 500 ملغ", "printed"),
    ("ar-03", "قرص واحد كل ثمان ساعات", "printed"),
    ("ar-04", "دواء السعال", "printed"),
    ("ar-05", "مرتين يوميا بعد الأكل", "printed_small"),
]

# A blank page — the harness must not hallucinate text that isn't there.
EMPTY_FIXTURES = [
    ("blank-01", "", "blank"),
]


def _render(text: str, font_path: str, size: int, rtl: bool) -> Image.Image:
    font = ImageFont.truetype(font_path, size)
    img = Image.new("RGB", (900, 200), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    if rtl:
        draw.text((860, 100), text, font=font, fill=(0, 0, 0), anchor="ra")
    else:
        draw.text((40, 100), text, font=font, fill=(0, 0, 0), anchor="la")
    return img


def generate() -> list[dict]:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    for fixture_id, text, category in ENGLISH_FIXTURES:
        size = 28 if category == "printed_small" else 40
        img = _render(text, ENGLISH_FONT, size, rtl=False)
        img.save(IMAGES_DIR / f"{fixture_id}.png")
        manifest.append(
            {
                "id": fixture_id,
                "image": f"{fixture_id}.png",
                "groundTruthText": text,
                "language": "en",
                "category": category,
            }
        )

    for fixture_id, text, category in ARABIC_FIXTURES:
        size = 28 if category == "printed_small" else 40
        img = _render(text, ARABIC_FONT, size, rtl=True)
        img.save(IMAGES_DIR / f"{fixture_id}.png")
        manifest.append(
            {
                "id": fixture_id,
                "image": f"{fixture_id}.png",
                "groundTruthText": text,
                "language": "ar",
                "category": category,
            }
        )

    for fixture_id, text, category in EMPTY_FIXTURES:
        img = Image.new("RGB", (900, 200), color=(255, 255, 255))
        img.save(IMAGES_DIR / f"{fixture_id}.png")
        manifest.append(
            {
                "id": fixture_id,
                "image": f"{fixture_id}.png",
                "groundTruthText": text,
                "language": "en",
                "category": category,
            }
        )

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    fixtures = generate()
    print(f"Generated {len(fixtures)} fixtures under {IMAGES_DIR}")
