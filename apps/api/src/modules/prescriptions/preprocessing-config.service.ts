import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { PreprocessingConfigDto } from './python-ocr-client.service';

/**
 * CR-001 Sprint OCR-02 — resolves the image-processing engine's
 * configuration from Settings (ADR-008: configuration over hard-coded
 * values). Python holds no Settings/DB access, so this is passed in on
 * every /v1/preprocess call rather than read on the Python side.
 */
@Injectable()
export class PreprocessingConfigService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(): Promise<PreprocessingConfigDto> {
    const [
      enabled,
      minImageWidth,
      minImageHeight,
      minQualityScore,
      maxRotationDegrees,
      minContrast,
      maxNoise,
      version,
    ] = await Promise.all([
      this.settings.resolve('prescriptions.preprocessing.enabled_processors') as Promise<
        Record<string, boolean>
      >,
      this.settings.resolve('prescriptions.preprocessing.min_image_width').then(Number),
      this.settings.resolve('prescriptions.preprocessing.min_image_height').then(Number),
      this.settings.resolve('prescriptions.preprocessing.min_quality_score').then(Number),
      this.settings.resolve('prescriptions.preprocessing.max_rotation_degrees').then(Number),
      this.settings.resolve('prescriptions.preprocessing.min_contrast').then(Number),
      this.settings.resolve('prescriptions.preprocessing.max_noise').then(Number),
      this.settings.resolve('prescriptions.preprocessing.version') as Promise<string>,
    ]);
    return {
      enabled,
      minImageWidth,
      minImageHeight,
      minQualityScore,
      maxRotationDegrees,
      minContrast,
      maxNoise,
      version,
    };
  }
}
