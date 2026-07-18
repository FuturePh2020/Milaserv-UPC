import { Module } from '@nestjs/common';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';
import {
  LocalDiskPrescriptionStorage,
  MinioPrescriptionStorage,
  PRESCRIPTION_STORAGE,
} from './prescription-storage';

@Module({
  providers: [
    LocalDiskPrescriptionStorage,
    MinioPrescriptionStorage,
    {
      provide: PRESCRIPTION_STORAGE,
      inject: [ENV, LocalDiskPrescriptionStorage, MinioPrescriptionStorage],
      useFactory: (env: Env, local: LocalDiskPrescriptionStorage, minio: MinioPrescriptionStorage) =>
        env.PRESCRIPTION_STORAGE_DRIVER === 'minio' ? minio : local,
    },
  ],
  // LocalDiskPrescriptionStorage is exported directly too: the local
  // download route needs its token-verification method regardless of
  // which driver PRESCRIPTION_STORAGE resolves to.
  exports: [PRESCRIPTION_STORAGE, LocalDiskPrescriptionStorage],
})
export class PrescriptionStorageModule {}
