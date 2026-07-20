"""Internal service authentication (CR-001 Sprint OCR-03 design brief §12,
§18). Mirrors this project's existing `X-Integration-Token` shared-secret
pattern (apps/api's connectors module) for machine-to-machine calls — here
the direction is reversed (NestJS calling into this service, not an
external system calling into NestJS), same mechanism.

Fails closed once `OCR_INTERNAL_TOKEN` is configured: every request to a
processing route must present a matching `X-Internal-Token` header. When
the token is left unset (e.g. quick local development), the check is
skipped entirely and a warning is logged once at startup — this service
was never designed to be reachable from outside the private compose
network in the first place (no route here is ever `@Public()`-equivalent
in intent), but an explicit, unmissable warning is safer than a silent
gap when someone forgets to set it for a real deployment.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import Header, HTTPException

from app.config import RUNTIME

logger = logging.getLogger("app.auth")

if not RUNTIME.internal_token:
    logger.warning(
        "OCR_INTERNAL_TOKEN is not set — internal processing endpoints are "
        "unauthenticated. This is only acceptable for local development; "
        "set OCR_INTERNAL_TOKEN (and the matching value on the NestJS "
        "side) before exposing this service to any shared environment."
    )


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    if not RUNTIME.internal_token:
        return
    if not x_internal_token or not hmac.compare_digest(x_internal_token, RUNTIME.internal_token):
        raise HTTPException(status_code=401, detail="Invalid or missing internal service token")
