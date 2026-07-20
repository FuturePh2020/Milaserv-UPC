"""Configuration contract for the Sprint OCR-02 image-processing engine.

Every threshold NestJS's Settings module owns (ADR-008 — configuration
over hard-coded values) is passed in on each request; Python holds no
Settings/DB access, so it never reads these itself and always falls back
to the same defaults the seed data uses if a caller omits them (e.g. a
standalone pytest run).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

#: Every individually toggleable processor (design spec: "Each processor
#: must be individually enabled or disabled from configuration").
PROCESSOR_NAMES = [
    "validation",
    "qualityScoring",
    "blurDetection",
    "brightnessAnalysis",
    "contrastAnalysis",
    "noiseEstimation",
    "orientationDetection",
    "autoRotation",
    "perspectiveCorrection",
    "edgeDetection",
    "autoCrop",
    "backgroundCleanup",
    "shadowRemoval",
    "contrastEnhancement",
    "sharpening",
    "grayscale",
    "binarization",
]


class PreprocessingConfig(BaseModel):
    enabled: dict[str, bool] = Field(default_factory=lambda: dict.fromkeys(PROCESSOR_NAMES, True))

    min_image_width: int = Field(alias="minImageWidth", default=300)
    min_image_height: int = Field(alias="minImageHeight", default=300)
    min_quality_score: float = Field(alias="minQualityScore", default=50, ge=0, le=100)
    max_rotation_degrees: float = Field(alias="maxRotationDegrees", default=45, ge=0, le=180)
    min_contrast: float = Field(alias="minContrast", default=20, ge=0)
    max_noise: float = Field(alias="maxNoise", default=15, ge=0)
    version: str = Field(default="1.0.0")

    model_config = ConfigDict(populate_by_name=True)

    def is_enabled(self, processor: str) -> bool:
        return self.enabled.get(processor, True)
