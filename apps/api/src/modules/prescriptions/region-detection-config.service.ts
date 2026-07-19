import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { RegionDetectionConfigDto } from './python-ocr-client.service';

/**
 * CR-001 Sprint OCR-02 Extension — resolves the region-detection engine's
 * configuration from Settings (ADR-008). Same pattern as
 * PreprocessingConfigService: Python holds no Settings/DB access, so
 * this is passed in on every /v1/detect-region call.
 */
@Injectable()
export class RegionDetectionConfigService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(): Promise<RegionDetectionConfigDto> {
    const [
      enabled,
      minConfidence,
      minRegionAreaRatio,
      maxCandidates,
      screenshotAspectRatioMin,
      screenshotAspectRatioMax,
      whatsappHintEnabled,
    ] = await Promise.all([
      this.settings.resolve('prescriptions.region_detection.enabled') as Promise<boolean>,
      this.settings.resolve('prescriptions.region_detection.min_confidence').then(Number),
      this.settings.resolve('prescriptions.region_detection.min_region_area_ratio').then(Number),
      this.settings.resolve('prescriptions.region_detection.max_candidates').then(Number),
      this.settings
        .resolve('prescriptions.region_detection.screenshot_aspect_ratio_min')
        .then(Number),
      this.settings
        .resolve('prescriptions.region_detection.screenshot_aspect_ratio_max')
        .then(Number),
      this.settings.resolve(
        'prescriptions.region_detection.whatsapp_hint_enabled',
      ) as Promise<boolean>,
    ]);
    return {
      enabled,
      minConfidence,
      minRegionAreaRatio,
      maxCandidates,
      screenshotAspectRatioMin,
      screenshotAspectRatioMax,
      whatsappHintEnabled,
    };
  }
}
