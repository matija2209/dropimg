import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { StorageDriver, StoredFile } from './types.js';

export class LocalStorageDriver implements StorageDriver {
  private uploadDir: string;
  private publicBaseUrl: string;

  constructor(config: { uploadDir: string; publicBaseUrl: string }) {
    this.uploadDir = config.uploadDir;
    this.publicBaseUrl = config.publicBaseUrl;
  }

  async put(input: {
    key: string;
    body: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<StoredFile> {
    const filePath = join(this.uploadDir, input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);

    return {
      key: input.key,
      url: this.publicUrl(input.key),
      size: input.body.length,
      mimeType: input.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.uploadDir, key);
    await unlink(filePath).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async get(key: string): Promise<{ body: any; mimeType?: string }> {
    const filePath = join(this.uploadDir, key);
    const body = createReadStream(filePath);

    const ext = extname(key).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.m4v': 'video/x-m4v',
      '.mkv': 'video/x-matroska',
    };

    return {
      body,
      mimeType: mimeTypes[ext],
    };
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/raw/${key}`;
  }
}
