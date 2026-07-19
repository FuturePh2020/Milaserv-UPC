"""Infra-level OCR runtime configuration (CR-001 Sprint OCR-03).

Distinct from every other *Config in this service (PreprocessingConfig,
RegionDetectionConfig): those are genuinely per-request, resolved by
NestJS Settings (ADR-008) since this service holds no DB/Settings access.
Model selection, device, and cache location are process-lifetime infra
concerns instead — the same category as PRESCRIPTION_OCR_WORKER_ENABLED
on the NestJS side — so plain env vars are the right layer, read once at
import time rather than per request.

IMPORTANT: this module must be the first thing imported in the process,
before `paddleocr`/`paddlex` are imported anywhere (including
transitively) — both read the PADDLE_PDX_* variables set below into
module-level constants at import time (verified directly against
paddlex/utils/flags.py and paddlex/utils/fonts/__init__.py), so setting
them later has no effect.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    val = os.environ.get(name)
    return int(val) if val else default


@dataclass(frozen=True)
class OcrRuntimeConfig:
    provider: str
    device: str
    use_gpu: bool
    model_cache_path: str
    default_language: str
    enable_arabic: bool
    enable_english: bool
    enable_orientation: bool
    enable_document_unwarping: bool
    batch_size: int
    request_timeout_seconds: int
    internal_token: str | None


def load_runtime_config() -> OcrRuntimeConfig:
    return OcrRuntimeConfig(
        # Defaults to "mock", not "paddleocr": the mock provider always
        # works with zero setup (existing Sprint OCR-01 behavior, and
        # every current test's baseline); a real deployment opts into
        # PaddleOCR explicitly (docker-compose.yml sets OCR_PROVIDER for
        # the containerized service) once its models are actually
        # reachable/cached — never a silent, unverified default switch.
        provider=os.environ.get("OCR_PROVIDER", "mock"),
        device=os.environ.get("OCR_DEVICE", "cpu"),
        use_gpu=_env_bool("OCR_USE_GPU", False),
        model_cache_path=os.environ.get("OCR_MODEL_CACHE_PATH", "/models"),
        default_language=os.environ.get("OCR_DEFAULT_LANGUAGE", "auto"),
        enable_arabic=_env_bool("OCR_ENABLE_ARABIC", True),
        enable_english=_env_bool("OCR_ENABLE_ENGLISH", True),
        enable_orientation=_env_bool("OCR_ENABLE_ORIENTATION", True),
        enable_document_unwarping=_env_bool("OCR_ENABLE_DOCUMENT_UNWARPING", True),
        batch_size=_env_int("OCR_BATCH_SIZE", 4),
        request_timeout_seconds=_env_int("OCR_REQUEST_TIMEOUT_SECONDS", 120),
        internal_token=os.environ.get("OCR_INTERNAL_TOKEN") or None,
    )


RUNTIME = load_runtime_config()

# ── PaddleX/PaddleOCR environment wiring — must happen here, before any
# import of paddleocr/paddlex anywhere in this process. ────────────────

# Where model weights are cached across container restarts — mounted as a
# persistent Docker volume so `docker compose down && up` doesn't
# re-download ~100-200MB of models every time (design brief: "do not
# silently download models during every container startup").
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", RUNTIME.model_cache_path)

# PaddleX 3.7's own default is already "huggingface" (confirmed by
# reading paddlex/utils/flags.py directly) — set explicitly anyway so
# this doesn't silently change if a future paddlex release changes its
# default, and so it's documented in one obvious place.
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "huggingface")

# Without this, importing `paddleocr` makes a network call to
# paddle-model-ecology.bj.bcebos.com for a debug-visualization font (used
# only for optionally drawing annotated preview images — never for actual
# text recognition, and never requested by this service). Any local TTF
# satisfies the check; the Docker image installs fonts-dejavu-core and
# this points at it directly. Verified: this is the officially supported
# escape hatch (paddlex/utils/fonts/__init__.py checks this env var
# before attempting any download), not a workaround.
os.environ.setdefault(
    "PADDLE_PDX_LOCAL_FONT_FILE_PATH",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
