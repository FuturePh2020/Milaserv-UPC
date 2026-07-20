"""Text normalization (CR-001 Sprint OCR-03 design brief §8).

`rawText` is always stored exactly as the recognizer returned it —
nothing here ever touches it. These functions only build the separate
`normalizedText` field used for search/matching. No medication-specific
correction happens here (that belongs to the later Drug Matching Engine).
"""

from __future__ import annotations

import re
import unicodedata

_TATWEEL = "ـ"
# Arabic combining diacritics (harakat/tanwin/sukun/shadda/quranic marks)
# — U+064B-065F plus the standalone U+0670 (superscript alef).
_ARABIC_DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭ]")
# Arabic-Indic (U+0660-0669) and Extended Arabic-Indic/Persian
# (U+06F0-06F9) digits, in order, mapped to Western 0-9.
_ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_DIGIT_TRANSLATION = str.maketrans(
    _ARABIC_INDIC_DIGITS + _PERSIAN_DIGITS, "0123456789" * 2
)
# أ إ آ (hamza-above / hamza-below / madda) → bare alef ا, and ى (alef
# maksura) → ي (yeh) — standard Arabic *search* normalization. Deliberately
# NOT included: ة (teh marbuta) → ه (heh) — that substitution changes
# grammatical meaning and the design brief explicitly forbids it in the
# official/normalized text; only the alef and yeh families are safe to
# fold for matching purposes.
_ALEF_VARIANTS = str.maketrans("أإآى", "اااي")

_WHITESPACE_RUN = re.compile(r"\s+")


def normalize_arabic(text: str, *, normalize_digits: bool = True) -> str:
    """Searchable normalization for Arabic text. `text` is assumed to
    already be raw OCR output — never mutated in place, only read."""
    result = unicodedata.normalize("NFKC", text)
    result = result.replace(_TATWEEL, "")
    result = _ARABIC_DIACRITICS.sub("", result)
    result = result.translate(_ALEF_VARIANTS)
    if normalize_digits:
        result = result.translate(_DIGIT_TRANSLATION)
    result = _WHITESPACE_RUN.sub(" ", result).strip()
    return result


# Curly/smart quotes and common OCR-misread quote glyphs → straight ASCII.
_QUOTE_TRANSLATION = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "´": "'",
        "`": "'",
    }
)
# En dash, em dash, minus sign, non-breaking hyphen → ASCII hyphen.
_HYPHEN_TRANSLATION = str.maketrans(
    {
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "–": "-",
        "—": "-",
        "−": "-",
    }
)


def normalize_english(text: str) -> str:
    """Searchable normalization for English/Latin text."""
    result = unicodedata.normalize("NFKC", text)
    result = result.translate(_QUOTE_TRANSLATION)
    result = result.translate(_HYPHEN_TRANSLATION)
    result = result.lower()
    result = _WHITESPACE_RUN.sub(" ", result).strip()
    return result


def normalize_text(text: str, script: str | None) -> str:
    """Dispatches on the block's detected script. Unknown/mixed scripts
    fall back to the English normalizer (whitespace/quote/hyphen
    normalization only, no lowercasing assumption is lost for Arabic
    since Arabic has no case) — never raises on an unexpected script."""
    if script == "ARABIC":
        return normalize_arabic(text)
    return normalize_english(text)
