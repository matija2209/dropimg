import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { ImageProcessingError, processAndStoreImage } from './image-processing.js';
import type { StorageDriver, StoredFile } from '../storage/types.js';

class MemoryStorageDriver implements StorageDriver {
  files = new Map<string, { body: Buffer; mimeType: string }>();

  async put(input: {
    key: string;
    body: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<StoredFile> {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);

    this.files.set(input.key, {
      body,
      mimeType: input.mimeType,
    });

    return {
      key: input.key,
      url: this.publicUrl(input.key),
      size: body.length,
      mimeType: input.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async get(key: string): Promise<{ body: Buffer; mimeType?: string }> {
    const file = this.files.get(key);

    if (!file) {
      throw new Error('File not found');
    }

    return {
      body: file.body,
      mimeType: file.mimeType,
    };
  }

  publicUrl(key: string): string {
    return `memory://${key}`;
  }
}

test('compress-jpg stores a smaller canonical JPG and keeps variants', async () => {
  const storage = new MemoryStorageDriver();
  const source = await createPatternJpeg(256, 256, 95);

  const processed = await processAndStoreImage({
    id: 'compress-success',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: source,
    mode: 'compress-jpg',
    quality: 70,
    storage,
  });

  assert.equal(processed.original.mimeType, 'image/jpeg');
  assert.ok(processed.original.storageKey.endsWith('/original.jpg'));
  assert.ok(processed.original.size < source.length);
  assert.equal(processed.processing.sourceMimeType, 'image/jpeg');
  assert.equal(processed.processing.outputMimeType, 'image/jpeg');
  assert.ok(processed.processing.savedBytes > 0);
  assert.ok(processed.variants.length > 0);
});

test('compress-jpg rejects non-JPG uploads', async () => {
  const storage = new MemoryStorageDriver();
  const source = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  await assert.rejects(
    processAndStoreImage({
      id: 'compress-reject',
      fileName: 'image.png',
      mimeType: 'image/png',
      buffer: source,
      mode: 'compress-jpg',
      storage,
    }),
    (error: unknown) =>
      error instanceof ImageProcessingError &&
      error.message === 'Compress JPG mode only accepts JPG uploads.'
  );
});

test('compress-jpg falls back to the source bytes when recompression is larger', async () => {
  const storage = new MemoryStorageDriver();
  const source = await createPatternJpeg(32, 32, 25);

  const processed = await processAndStoreImage({
    id: 'compress-fallback',
    fileName: 'tiny.jpg',
    mimeType: 'image/jpeg',
    buffer: source,
    mode: 'compress-jpg',
    quality: 92,
    storage,
  });

  assert.equal(processed.original.size, source.length);
  assert.equal(processed.processing.savedBytes, 0);
  assert.equal(processed.processing.outputSize, source.length);

  const stored = storage.files.get(processed.original.storageKey);
  assert.ok(stored);
  assert.deepEqual(stored.body, source);
});

test('png-to-jpg converts PNG uploads to canonical JPG and flattens transparency to white', async () => {
  const storage = new MemoryStorageDriver();
  const source = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();

  const processed = await processAndStoreImage({
    id: 'png-to-jpg',
    fileName: 'transparent.png',
    mimeType: 'image/png',
    buffer: source,
    mode: 'png-to-jpg',
    quality: 90,
    storage,
  });

  assert.equal(processed.original.mimeType, 'image/jpeg');
  assert.ok(processed.original.storageKey.endsWith('/original.jpg'));
  assert.equal(processed.processing.sourceMimeType, 'image/png');
  assert.equal(processed.processing.outputMimeType, 'image/jpeg');
  assert.ok(processed.variants.length > 0);

  const stored = storage.files.get(processed.original.storageKey);
  assert.ok(stored);

  const { data } = await sharp(stored.body).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240);
  assert.ok(data[1] > 240);
  assert.ok(data[2] > 240);
});

test('strip-metadata runs through the stripping pipeline', async () => {
  const storage = new MemoryStorageDriver();
  const source = await createPatternJpeg(128, 128, 90);

  const processed = await processAndStoreImage({
    id: 'strip-test',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: source,
    mode: 'strip-metadata',
    storage,
  });

  assert.equal(processed.original.mimeType, 'image/jpeg');
  assert.equal(processed.processing.mode, 'strip-metadata');
  assert.ok(processed.original.size > 0);
});

test('png-to-jpg rejects non-PNG uploads', async () => {
  const storage = new MemoryStorageDriver();
  const source = await createPatternJpeg(48, 48, 90);

  await assert.rejects(
    processAndStoreImage({
      id: 'png-reject',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: source,
      mode: 'png-to-jpg',
      storage,
    }),
    (error: unknown) =>
      error instanceof ImageProcessingError &&
      error.message === 'PNG to JPG mode only accepts PNG uploads.'
  );
});

async function createPatternJpeg(width: number, height: number, quality: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    pixels[offset] = (index * 37) % 256;
    pixels[offset + 1] = (index * 53) % 256;
    pixels[offset + 2] = (index * 97) % 256;
  }

  return sharp(pixels, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
