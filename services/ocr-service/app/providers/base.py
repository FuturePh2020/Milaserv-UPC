"""OCR provider abstraction (CR-001 design spec §6).

Every real provider (PaddleOCR, Tesseract, and later Azure/Textract/
Google Document AI/an internal handwriting model) implements this same
interface. Nothing outside this module needs to know which provider is
active — the registry below is the only place that decides.
"""

from __future__ import annotations

from typing import Protocol

from app.schemas import OCRBlock


class OCRProvider(Protocol):
    name: str
    supports_handwriting: bool
    # False only for cloud providers — enforced by the registry, not
    # advisory (design spec §6): a non-local provider is never selected
    # unless a future sprint explicitly enables cloud OCR.
    is_local: bool

    def detect_and_recognize(self, image_url: str) -> list[OCRBlock]: ...

    def health_check(self) -> bool: ...


class ProviderRegistry:
    """Selects the active provider. Sprint OCR-01 registers only the mock
    provider; OCR-03 adds PaddleOCR/Tesseract behind the same call site.
    """

    def __init__(self) -> None:
        self._providers: dict[str, OCRProvider] = {}
        self._default: str | None = None

    def register(self, provider: OCRProvider, *, default: bool = False) -> None:
        self._providers[provider.name] = provider
        if default or self._default is None:
            self._default = provider.name

    def get(self, name: str | None = None) -> OCRProvider:
        key = name or self._default
        if key is None or key not in self._providers:
            raise ValueError(f"Unknown OCR provider: {key!r}")
        provider = self._providers[key]
        if not provider.is_local:
            # Cloud providers are out of scope until a later sprint wires
            # them behind an explicit "allow cloud OCR" setting, mirroring
            # the Phase 12 AI policy gate's doctrine for this different
            # data flow (design spec §6, §9).
            raise PermissionError(
                f"Provider {provider.name!r} is not local; cloud OCR is not enabled"
            )
        return provider

    def names(self) -> list[str]:
        return list(self._providers.keys())


registry = ProviderRegistry()
