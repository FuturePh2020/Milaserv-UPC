"""Prescription OCR microservice — CR-001 Sprint OCR-01 skeleton.

Owns: image quality analysis, preprocessing, text detection/recognition,
language detection, medicine-line candidate extraction (CR-001 design
spec §2). Never touches Postgres and holds no DB credentials — NestJS
owns the DIC drug master and all matching (design spec §1).

Sprint OCR-01 registers only the deterministic mock provider; real CV
(PaddleOCR/Tesseract) lands in OCR-02/OCR-03 behind the same
ProviderRegistry, with zero changes to this file's routes or to NestJS.
"""

from __future__ import annotations

import time

from fastapi import FastAPI

from app.providers.base import registry
from app.providers.mock import MockOCRProvider, mock_medicine_lines, mock_quality_score
from app.schemas import (
    AnalyzeQualityRequest,
    AnalyzeQualityResponse,
    CandidateLine,
    DetectAndRecognizeRequest,
    DetectAndRecognizeResponse,
    DetectCandidatesRequest,
    DetectCandidatesResponse,
    HealthResponse,
    PreprocessRequest,
    PreprocessResponse,
)

registry.register(MockOCRProvider(), default=True)

app = FastAPI(title="Milaserv360 Prescription OCR Service", version="0.1.0")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    provider = registry.get()
    return HealthResponse(status="ok" if provider.health_check() else "degraded", provider=provider.name)


@app.post("/v1/analyze-quality", response_model=AnalyzeQualityResponse)
def analyze_quality(req: AnalyzeQualityRequest) -> AnalyzeQualityResponse:
    score, issues = mock_quality_score(req.image_url)
    return AnalyzeQualityResponse(qualityScore=score, issues=issues)


@app.post("/v1/preprocess", response_model=PreprocessResponse)
def preprocess(req: PreprocessRequest) -> PreprocessResponse:
    # Sprint OCR-01: no real image transformation yet — the enhanced image
    # is the original, orientation is assumed correct. OCR-02 replaces
    # this body with real orientation/perspective/crop/denoise/contrast/
    # sharpen/binarize stages; the response shape does not change.
    return PreprocessResponse(
        enhancedImageUrl=req.image_url,
        orientation=0,
        stagesApplied=["mock_passthrough"],
    )


@app.post("/v1/detect-and-recognize", response_model=DetectAndRecognizeResponse)
def detect_and_recognize(req: DetectAndRecognizeRequest) -> DetectAndRecognizeResponse:
    started = time.monotonic()
    provider = registry.get(req.provider)
    blocks = provider.detect_and_recognize(req.image_url)
    languages = {b.language for b in blocks}
    detected_language = "mixed" if len(languages) > 1 else next(iter(languages), "en")
    elapsed_ms = int((time.monotonic() - started) * 1000)
    return DetectAndRecognizeResponse(
        blocks=blocks,
        detectedLanguage=detected_language,
        providerUsed=provider.name,
        processingTimeMs=elapsed_ms,
    )


@app.post("/v1/detect-candidates", response_model=DetectCandidatesResponse)
def detect_candidates(req: DetectCandidatesRequest) -> DetectCandidatesResponse:
    indices = mock_medicine_lines(req.blocks)
    lines = [
        CandidateLine(blockIndex=i, extractedDrugText=req.blocks[i].raw_text)
        for i in indices
    ]
    return DetectCandidatesResponse(candidateLines=lines)
