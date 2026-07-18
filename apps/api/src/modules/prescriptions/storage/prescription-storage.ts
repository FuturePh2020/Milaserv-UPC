import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';

/**
 * Object storage contract for prescription files (CR-001 design spec §9).
 * Deliberately separate from the generic Attachments `StorageDriver` —
 * prescriptions need signed-URL issuance, which general attachments don't.
 */
export interface PrescriptionStorageDriver {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Never a permanent/public link — always short-TTL and scoped to one key. */
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
}

export const PRESCRIPTION_STORAGE = Symbol('PRESCRIPTION_STORAGE');

export function newPrescriptionStorageKey(fileName: string): string {
  const hash = createHash('sha1').update(fileName).digest('hex').slice(0, 8);
  const rand = randomBytes(8).toString('hex');
  const now = new Date();
  return join(
    'prescriptions',
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    `${rand}-${hash}`,
  );
}

// ── Local-disk driver (default; dev/test parity for the signed-URL contract) ──

/**
 * A signed URL here is an HMAC-verified, time-limited token over the storage
 * key — the same security property a real S3 presigned URL provides
 * (tamper-proof, short-lived, scoped to one object). It intentionally does
 * NOT require a JWT session on the download route: possessing a valid,
 * unexpired signature is the authorization for that narrow window, exactly
 * like a real presigned URL. The route is only ever handed out after the
 * caller's own permission check (see PrescriptionsController).
 */
@Injectable()
export class LocalDiskPrescriptionStorage implements PrescriptionStorageDriver {
  private readonly baseDir: string;
  private readonly hmacSecret: string;

  constructor(@Inject(ENV) env: Env) {
    this.baseDir = env.PRESCRIPTION_STORAGE_DIR;
    // Reuses the JWT signing secret as the HMAC key — same trust boundary,
    // no extra secret to provision for local/dev deployments.
    this.hmacSecret = env.JWT_ACCESS_SECRET;
  }

  private path(key: string): string {
    return join(this.baseDir, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => undefined);
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, exp);
    const encodedKey = Buffer.from(key, 'utf8').toString('base64url');
    return `/api/v1/prescriptions/files/${encodedKey}?exp=${exp}&sig=${sig}`;
  }

  private sign(key: string, exp: number): string {
    return createHmac('sha256', this.hmacSecret).update(`${key}|${exp}`).digest('hex');
  }

  /** Used by the download route to verify a token before streaming bytes. */
  verify(key: string, exp: number, sig: string): boolean {
    if (Date.now() / 1000 > exp) return false;
    const expected = Buffer.from(this.sign(key, exp), 'hex');
    const provided = Buffer.from(sig, 'hex');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}

// ── MinIO driver (S3-compatible; docker-compose / production) ──────────
//
// Not exercised by this repo's local test run (no MinIO service available
// in every dev/CI sandbox) — selected via PRESCRIPTION_STORAGE_DRIVER=minio,
// intended for the Docker Compose deployment (CR-001 design spec §1/§9).

@Injectable()
export class MinioPrescriptionStorage implements PrescriptionStorageDriver {
  private readonly client: import('minio').Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    // Lazy require: keeps the `minio` client out of the local-driver path
    // entirely when it's never selected.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('minio') as typeof import('minio');
    this.client = new Client({
      endPoint: env.MINIO_ENDPOINT ?? 'localhost',
      port: env.MINIO_PORT ?? 9000,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY ?? '',
      secretKey: env.MINIO_SECRET_KEY ?? '',
    });
    this.bucket = env.MINIO_BUCKET_PRESCRIPTIONS;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(
      this.bucket,
      key,
      data,
      data.length,
      contentType ? { 'Content-Type': contentType } : undefined,
    );
  }

  async get(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key).catch(() => undefined);
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, ttlSeconds);
  }

  private async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) await this.client.makeBucket(this.bucket);
  }
}
