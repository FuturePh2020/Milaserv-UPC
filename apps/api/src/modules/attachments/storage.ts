import { createHash, randomBytes } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Injectable } from '@nestjs/common';

/** Storage driver contract — S3-compatible driver implements this later (spec A7). */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export function newStorageKey(fileName: string): string {
  const hash = createHash('sha1').update(fileName).digest('hex').slice(0, 8);
  const rand = randomBytes(8).toString('hex');
  const now = new Date();
  return join(
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    `${rand}-${hash}`,
  );
}

@Injectable()
export class LocalDiskStorage implements StorageDriver {
  private readonly baseDir = process.env.ATTACHMENTS_DIR ?? join(process.cwd(), 'storage');

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
}
