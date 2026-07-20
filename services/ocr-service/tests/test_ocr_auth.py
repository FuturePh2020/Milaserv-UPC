"""CR-001 Sprint OCR-03 — internal service authentication (design brief
§12, §18: "Protect internal processing endpoints... do not expose them
publicly")."""

from __future__ import annotations

import importlib

import pytest
from fastapi import HTTPException


@pytest.fixture
def auth_module(monkeypatch):
    """Reloads app.auth against a controlled RUNTIME.internal_token —
    the module reads it once at import time via app.config.RUNTIME."""
    import app.config as config_module

    monkeypatch.setattr(
        config_module,
        "RUNTIME",
        config_module.OcrRuntimeConfig(
            provider="mock",
            device="cpu",
            use_gpu=False,
            model_cache_path="/models",
            default_language="auto",
            enable_arabic=True,
            enable_english=True,
            enable_orientation=True,
            enable_document_unwarping=True,
            batch_size=4,
            request_timeout_seconds=120,
            internal_token="expected-token",
        ),
    )
    import app.auth as auth_module_ref

    return importlib.reload(auth_module_ref)


def test_rejects_missing_token(auth_module):
    with pytest.raises(HTTPException) as exc_info:
        auth_module.require_internal_token(x_internal_token=None)
    assert exc_info.value.status_code == 401


def test_rejects_wrong_token(auth_module):
    with pytest.raises(HTTPException) as exc_info:
        auth_module.require_internal_token(x_internal_token="wrong")
    assert exc_info.value.status_code == 401


def test_accepts_correct_token(auth_module):
    auth_module.require_internal_token(x_internal_token="expected-token")  # does not raise


def test_skips_check_entirely_when_no_token_configured(monkeypatch):
    import app.config as config_module

    monkeypatch.setattr(
        config_module,
        "RUNTIME",
        config_module.OcrRuntimeConfig(
            provider="mock",
            device="cpu",
            use_gpu=False,
            model_cache_path="/models",
            default_language="auto",
            enable_arabic=True,
            enable_english=True,
            enable_orientation=True,
            enable_document_unwarping=True,
            batch_size=4,
            request_timeout_seconds=120,
            internal_token=None,
        ),
    )
    import app.auth as auth_module_ref

    reloaded = importlib.reload(auth_module_ref)
    reloaded.require_internal_token(x_internal_token=None)  # does not raise
