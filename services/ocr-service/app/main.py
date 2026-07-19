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

import base64
import time

import httpx
from fastapi import FastAPI, HTTPException

from app.preprocessing.config import PreprocessingConfig
from app.preprocessing.pipeline import ImageVersion, PagePreprocessResult, run_preprocessing
from app.providers.base import registry
from app.providers.mock import MockOCRProvider, mock_medicine_lines, mock_quality_score
from app.region_detection.config import RegionDetectionConfig
from app.region_detection.pipeline import detect as detect_region
from app.schemas import (
    AnalyzeQualityRequest,
    AnalyzeQualityResponse,
    CandidateLine,
    DetectAndRecognizeRequest,
    DetectAndRecognizeResponse,
    DetectCandidatesRequest,
    DetectCandidatesResponse,
    DetectRegionRequest,
    DetectRegionResponse,
    HealthResponse,
    ImageVersionDto,
    PagePreprocessDto,
    PreprocessRequest,
    PreprocessResponse,
    RegionCandidateDto,
)

IMAGE_FETCH_TIMEOUT_SECONDS = 30

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


@app.post("/v1/detect-region", response_model=DetectRegionResponse)
def detect_region_endpoint(req: DetectRegionRequest) -> DetectRegionResponse:
    """CR-001 Sprint OCR-02 Extension — Universal Image Intake: finds the
    probable prescription region inside a screenshot/photo before any
    preprocessing or OCR runs (design doc: "Prescription Region
    Detector"). No OCR text recognition happens here — pixels and
    geometry only.
    """
    try:
        resp = httpx.get(req.image_url, timeout=IMAGE_FETCH_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=422, detail=f"could not fetch imageUrl: {exc}") from exc

    config_dto = req.config
    config = RegionDetectionConfig(
        enabled=config_dto.enabled if config_dto else True,
        minConfidence=config_dto.min_confidence if config_dto else 0.55,
        minRegionAreaRatio=config_dto.min_region_area_ratio if config_dto else 0.08,
        maxCandidates=config_dto.max_candidates if config_dto else 5,
        screenshotAspectRatioMin=config_dto.screenshot_aspect_ratio_min if config_dto else 1.6,
        screenshotAspectRatioMax=config_dto.screenshot_aspect_ratio_max if config_dto else 2.6,
        whatsappHintEnabled=config_dto.whatsapp_hint_enabled if config_dto else True,
    )

    try:
        result = detect_region(resp.content, config)
    except Exception as exc:  # noqa: BLE001 — surfaced as a clean 422, not a 500 stack trace
        raise HTTPException(status_code=422, detail=f"could not analyze image: {exc}") from exc

    return DetectRegionResponse(
        sourceTypeHint=result.source_type_hint,
        screenshotDetected=result.screenshot_detected,
        screenshotConfidence=result.screenshot_confidence,
        screenshotApplicationHint=result.screenshot_application_hint,
        originalWidth=result.original_width,
        originalHeight=result.original_height,
        regions=[
            RegionCandidateDto(
                regionIndex=r.region_index,
                x=r.x,
                y=r.y,
                width=r.width,
                height=r.height,
                confidence=r.confidence,
                regionType=r.region_type,
            )
            for r in result.regions
        ],
        bestRegionIndex=result.best_region_index,
        manualCropRequired=result.manual_crop_required,
    )


def _versions_to_dto(versions: dict[str, ImageVersion]) -> dict[str, ImageVersionDto]:
    return {
        key: ImageVersionDto(
            imageBase64=base64.b64encode(v.image_bytes).decode("ascii"),
            width=v.width,
            height=v.height,
            format=v.format,
        )
        for key, v in versions.items()
    }


def _page_to_dto(page: PagePreprocessResult) -> PagePreprocessDto:
    return PagePreprocessDto(
        qualityScore=page.quality_score,
        qualityStatus=page.quality_status,
        metrics=page.metrics,
        versions=_versions_to_dto(page.versions),
        stagesApplied=page.stages_applied,
        processorTimingsMs=page.processor_timings_ms,
        processorFailures=page.processor_failures,
    )


@app.post("/v1/preprocess", response_model=PreprocessResponse)
def preprocess(req: PreprocessRequest) -> PreprocessResponse:
    """CR-001 Sprint OCR-02 — Image Processing & Quality Engine (design
    spec: 18-step pipeline). No OCR text recognition happens here; that
    is Sprint OCR-03's job, using the OCR-ready image this produces.
    """
    try:
        resp = httpx.get(req.image_url, timeout=IMAGE_FETCH_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=422, detail=f"could not fetch imageUrl: {exc}") from exc

    config_dto = req.config
    config = PreprocessingConfig(
        enabled=config_dto.enabled if config_dto else {},
        minImageWidth=config_dto.min_image_width if config_dto else 300,
        minImageHeight=config_dto.min_image_height if config_dto else 300,
        minQualityScore=config_dto.min_quality_score if config_dto else 50,
        maxRotationDegrees=config_dto.max_rotation_degrees if config_dto else 45,
        minContrast=config_dto.min_contrast if config_dto else 20,
        maxNoise=config_dto.max_noise if config_dto else 15,
        version=config_dto.version if config_dto else "1.0.0",
    )

    crop_box = req.preset_crop_box.model_dump() if req.preset_crop_box else None
    try:
        result = run_preprocessing(resp.content, config, preset_crop_box=crop_box)
    except Exception as exc:  # noqa: BLE001 — surfaced as a clean 422, not a 500 stack trace
        raise HTTPException(status_code=422, detail=f"could not process image: {exc}") from exc

    primary = result.primary
    return PreprocessResponse(
        qualityScore=primary.quality_score,
        qualityStatus=primary.quality_status,
        metrics=primary.metrics,
        versions=_versions_to_dto(primary.versions),
        stagesApplied=primary.stages_applied,
        processorTimingsMs=primary.processor_timings_ms,
        processorFailures=primary.processor_failures,
        processingDurationMs=result.processing_duration_ms,
        pageCount=result.page_count,
        pages=[_page_to_dto(p) for p in result.pages] if result.page_count > 1 else None,
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
