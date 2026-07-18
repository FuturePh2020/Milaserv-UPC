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


class PreprocessRequest(BaseModel):
    image_url: str = Field(alias="imageUrl")

    model_config = ConfigDict(populate_by_name=True)


class PreprocessResponse(BaseModel):
    enhanced_image_url: str = Field(alias="enhancedImageUrl")
    orientation: int
    stages_applied: list[str] = Field(alias="stagesApplied", default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class DetectAndRecognizeRequest(BaseModel):
    image_url: str = Field(alias="imageUrl")
    provider: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class OCRBlock(BaseModel):
    raw_text: str = Field(alias="rawText")
    normalized_text: str = Field(alias="normalizedText")
    bounding_box: dict[str, float] = Field(alias="boundingBox")
    language: str
    confidence: float = Field(ge=0, le=1)
    line_number: int = Field(alias="lineNumber")

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
