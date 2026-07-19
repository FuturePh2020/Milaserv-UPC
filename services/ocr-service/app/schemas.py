"""Request/response models — must match the NestJS-facing contract in
docs/change-requests/CR-001-prescription-intelligence-engine.md §5.1
exactly. This module is the single source of truth for that contract on
the Python side.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AnalyzeQualityRequest(BaseModel):
    image_url: str = Field(alias="imageUrl")

    model_config = ConfigDict(populate_by_name=True)


class AnalyzeQualityResponse(BaseModel):
    quality_score: float = Field(alias="qualityScore", ge=0, le=1)
    issues: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class PreprocessingConfigDto(BaseModel):
    """CR-001 Sprint OCR-02 — every threshold NestJS Settings owns
    (ADR-008), passed in per-call since Python holds no Settings/DB
    access. Omitted fields fall back to the same defaults the seed uses.
    """

    enabled: dict[str, bool] = Field(default_factory=dict)
    min_image_width: int = Field(alias="minImageWidth", default=300)
    min_image_height: int = Field(alias="minImageHeight", default=300)
    min_quality_score: float = Field(alias="minQualityScore", default=50)
    max_rotation_degrees: float = Field(alias="maxRotationDegrees", default=45)
    min_contrast: float = Field(alias="minContrast", default=20)
    max_noise: float = Field(alias="maxNoise", default=15)
    version: str = "1.0.0"

    model_config = ConfigDict(populate_by_name=True)


class CropBoxDto(BaseModel):
    x: int
    y: int
    width: int
    height: int


class PreprocessRequest(BaseModel):
    image_url: str = Field(alias="imageUrl")
    config: PreprocessingConfigDto | None = None
    # CR-001 Sprint OCR-02 Extension — a confirmed region/manual crop
    # (design doc: "Prescription Region Detector") applied before the
    # 18-step pipeline runs, so screenshot chrome never reaches OCR.
    preset_crop_box: CropBoxDto | None = Field(alias="presetCropBox", default=None)

    model_config = ConfigDict(populate_by_name=True)


class ImageVersionDto(BaseModel):
    image_base64: str = Field(alias="imageBase64")
    width: int
    height: int
    format: str = "PNG"

    model_config = ConfigDict(populate_by_name=True)


class PagePreprocessDto(BaseModel):
    quality_score: float = Field(alias="qualityScore")
    quality_status: str = Field(alias="qualityStatus")
    metrics: dict
    versions: dict[str, ImageVersionDto]
    stages_applied: list[str] = Field(alias="stagesApplied")
    processor_timings_ms: dict[str, int] = Field(alias="processorTimingsMs")
    processor_failures: list[str] = Field(alias="processorFailures")

    model_config = ConfigDict(populate_by_name=True)


class PreprocessResponse(BaseModel):
    quality_score: float = Field(alias="qualityScore")
    quality_status: str = Field(alias="qualityStatus")
    metrics: dict
    versions: dict[str, ImageVersionDto]
    stages_applied: list[str] = Field(alias="stagesApplied")
    processor_timings_ms: dict[str, int] = Field(alias="processorTimingsMs")
    processor_failures: list[str] = Field(alias="processorFailures")
    processing_duration_ms: int = Field(alias="processingDurationMs")
    page_count: int = Field(alias="pageCount")
    # Populated only for multi-page PDFs (page_count > 1) — one entry per
    # rasterized page, for callers that want more than page 1.
    pages: list[PagePreprocessDto] | None = None

    model_config = ConfigDict(populate_by_name=True)


class DetectAndRecognizeRequest(BaseModel):
    image_url: str = Field(alias="imageUrl")
    provider: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class RecognitionCandidateDto(BaseModel):
    """CR-001 Sprint OCR-03 — an alternative reading preserved when two
    language passes scored a region closely (design brief §4 "Option B")."""

    text: str
    language: str
    confidence: float = Field(ge=0, le=1)

    model_config = ConfigDict(populate_by_name=True)


class OCRBlock(BaseModel):
    raw_text: str = Field(alias="rawText")
    normalized_text: str = Field(alias="normalizedText")
    bounding_box: dict[str, float] = Field(alias="boundingBox")
    language: str
    confidence: float = Field(ge=0, le=1)
    line_number: int = Field(alias="lineNumber")

    # CR-001 Sprint OCR-03 — all additive/optional so MockOCRProvider's
    # existing three fixtures (Sprint OCR-01) remain valid without change.
    block_index: int = Field(alias="blockIndex", default=0)
    bounding_polygon: list[list[float]] | None = Field(alias="boundingPolygon", default=None)
    script: str | None = None
    direction: str | None = None
    recognition_candidates: list[RecognitionCandidateDto] = Field(
        alias="recognitionCandidates", default_factory=list
    )

    model_config = ConfigDict(populate_by_name=True)


class DetectAndRecognizeResponse(BaseModel):
    blocks: list[OCRBlock]
    detected_language: str = Field(alias="detectedLanguage")
    provider_used: str = Field(alias="providerUsed")
    processing_time_ms: int = Field(alias="processingTimeMs")

    model_config = ConfigDict(populate_by_name=True)


class DetectCandidatesRequest(BaseModel):
    blocks: list[OCRBlock]


class CandidateLine(BaseModel):
    block_index: int = Field(alias="blockIndex")
    extracted_drug_text: str = Field(alias="extractedDrugText")
    extracted_strength: str | None = Field(alias="extractedStrength", default=None)
    extracted_dosage_form: str | None = Field(alias="extractedDosageForm", default=None)

    model_config = ConfigDict(populate_by_name=True)


class DetectCandidatesResponse(BaseModel):
    candidate_lines: list[CandidateLine] = Field(alias="candidateLines")

    model_config = ConfigDict(populate_by_name=True)


class HealthResponse(BaseModel):
    status: str
    provider: str


# ── CR-001 Sprint OCR-02 Extension — Universal Image Intake ───────────


class RegionDetectionConfigDto(BaseModel):
    enabled: bool = True
    min_confidence: float = Field(alias="minConfidence", default=0.55)
    min_region_area_ratio: float = Field(alias="minRegionAreaRatio", default=0.08)
    max_candidates: int = Field(alias="maxCandidates", default=5)
    screenshot_aspect_ratio_min: float = Field(alias="screenshotAspectRatioMin", default=1.6)
    screenshot_aspect_ratio_max: float = Field(alias="screenshotAspectRatioMax", default=2.6)
    whatsapp_hint_enabled: bool = Field(alias="whatsappHintEnabled", default=True)

    model_config = ConfigDict(populate_by_name=True)


class DetectRegionRequest(BaseModel):
    image_url: str = Field(alias="imageUrl")
    config: RegionDetectionConfigDto | None = None

    model_config = ConfigDict(populate_by_name=True)


class RegionCandidateDto(BaseModel):
    region_index: int = Field(alias="regionIndex")
    x: int
    y: int
    width: int
    height: int
    confidence: float
    region_type: str = Field(alias="regionType")

    model_config = ConfigDict(populate_by_name=True)


class DetectRegionResponse(BaseModel):
    source_type_hint: str = Field(alias="sourceTypeHint")
    screenshot_detected: bool = Field(alias="screenshotDetected")
    screenshot_confidence: float = Field(alias="screenshotConfidence")
    screenshot_application_hint: str | None = Field(alias="screenshotApplicationHint", default=None)
    original_width: int = Field(alias="originalWidth")
    original_height: int = Field(alias="originalHeight")
    regions: list[RegionCandidateDto]
    best_region_index: int | None = Field(alias="bestRegionIndex", default=None)
    manual_crop_required: bool = Field(alias="manualCropRequired")

    model_config = ConfigDict(populate_by_name=True)
