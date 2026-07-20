"""Configuration contract for region detection (CR-001 Sprint OCR-02
Extension). Same pattern as app/preprocessing/config.py — Python holds no
Settings/DB access, so every threshold is passed in per-call and falls
back to the seed defaults when a caller omits it (e.g. a standalone
pytest run).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class RegionDetectionConfig(BaseModel):
    enabled: bool = True
    min_confidence: float = Field(alias="minConfidence", default=0.55, ge=0, le=1)
    min_region_area_ratio: float = Field(alias="minRegionAreaRatio", default=0.08, ge=0, le=1)
    max_candidates: int = Field(alias="maxCandidates", default=5, ge=1)
    screenshot_aspect_ratio_min: float = Field(alias="screenshotAspectRatioMin", default=1.6)
    screenshot_aspect_ratio_max: float = Field(alias="screenshotAspectRatioMax", default=2.6)
    whatsapp_hint_enabled: bool = Field(alias="whatsappHintEnabled", default=True)

    model_config = ConfigDict(populate_by_name=True)
