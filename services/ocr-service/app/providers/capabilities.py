"""Provider capability metadata (CR-001 Sprint OCR-03 design brief §11).

Every provider reports these honestly, based on its configured models and
actual test results — never aspirationally. PaddleOCR in particular must
not claim `supports_handwriting=True`; it is treated as an initial
printed-text OCR engine, not a validated handwriting solution (see the
provider's own docstring for why).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderCapabilities:
    supports_printed_text: bool
    supports_handwriting: bool
    supports_arabic: bool
    supports_english: bool
    supports_mixed_language: bool

    def to_camel_case_dict(self) -> dict[str, bool]:
        """Matches every other over-the-wire shape in this service
        (schemas.py's Field(alias="camelCase") convention) — dataclasses
        don't apply Pydantic's alias machinery, so this does it by hand."""
        return {
            "supportsPrintedText": self.supports_printed_text,
            "supportsHandwriting": self.supports_handwriting,
            "supportsArabic": self.supports_arabic,
            "supportsEnglish": self.supports_english,
            "supportsMixedLanguage": self.supports_mixed_language,
        }
