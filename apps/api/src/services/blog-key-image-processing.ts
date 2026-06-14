import { createHash } from 'node:crypto';
import { extname } from 'node:path';

import sharp from 'sharp';

import type { StorageDriver } from '../storage/types.js';
import {
  ImageProcessingError,
  variantPresets,
  type StaticVariantName,
} from './image-processing.js';

const OUTPUT_MIME_TYPES = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

type GeneratedVariantFile = {
  variant: StaticVariantName;
  key: string;
  mimeType: string;
  body: Buffer;
  width: number;
  height: number;
};

export type StoredBlogKeyImage = {
  storageKey: string;
  rawUrl: string;
  uploaded: boolean;
  width: number | null;
  height: number | null;
  mimeType: string;
  size: number;
  isAnimated: boolean;
  variants: Record<
    StaticVariantName,
    {
      storageKey: string;
      url: string;
      mimeType: string;
      width: number;
      height: number;
      size: number;
    }
  >;
};

export function buildSiblingVariantStorageKey(
  storageKey: string,
  variant: string,
  format: 'webp' | 'jpeg',
): string {
  const extension = extname(storageKey);
  const base = extension ? storageKey.slice(0, -extension.length) : storageKey;
  const variantExt = format === 'jpeg' ? '.jpg' : '.webp';
  return `${base}.${variant}${variantExt}`;
}

export function buildServiceImageId(storageKey: string): string {
  return `svc-${createHash('sha256').update(storageKey).digest('hex').slice(0, 12)}`;
}

function assertSafeStorageKey(storageKey: string): void {
  if (!storageKey || storageKey.includes('..') || storageKey.startsWith('/')) {
    throw new ImageProcessingError('Invalid storageKey', 400);
  }

  if (!/^[a-zA-Z0-9/_\-.]+$/.test(storageKey)) {
    throw new ImageProcessingError('storageKey contains invalid characters', 400);
  }
}

async function storageObjectExists(storage: StorageDriver, key: string): Promise<boolean> {
  try {
    await storage.get(key);
    return true;
  } catch {
    return false;
  }
}

async function generateStaticVariantAtKey(
  sourceBuffer: Buffer,
  preset: (typeof variantPresets)[number],
  storageKey: string,
): Promise<GeneratedVariantFile> {
  const pipeline = sharp(sourceBuffer).rotate();
  const key = buildSiblingVariantStorageKey(
    storageKey,
    preset.name,
    preset.format === 'jpeg' ? 'jpeg' : 'webp',
  );

  if (preset.strategy === 'contain-within') {
    const { data, info } = await pipeline
      .resize({
        width: preset.width,
        height: preset.height,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      variant: preset.name,
      key,
      mimeType: OUTPUT_MIME_TYPES.webp,
      body: data,
      width: info.width,
      height: info.height,
    };
  }

  if (preset.strategy === 'max-width') {
    const { data, info } = await pipeline
      .resize({
        width: preset.width,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });

    return {
      variant: preset.name,
      key,
      mimeType: OUTPUT_MIME_TYPES.webp,
      body: data,
      width: info.width,
      height: info.height,
    };
  }

  const foreground = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: preset.width,
      height: preset.height,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const background = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: preset.width,
      height: preset.height,
      fit: 'cover',
      position: 'centre',
    })
    .blur(24)
    .toBuffer();

  const composed = sharp(background).composite([{ input: foreground, gravity: 'center' }]);

  if (preset.format === 'jpeg') {
    const { data, info } = await composed
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      variant: preset.name,
      key,
      mimeType: OUTPUT_MIME_TYPES.jpeg,
      body: data,
      width: info.width,
      height: info.height,
    };
  }

  const { data, info } = await composed
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  return {
    variant: preset.name,
    key,
    mimeType: OUTPUT_MIME_TYPES.webp,
    body: data,
    width: info.width,
    height: info.height,
  };
}

async function buildExistingResponse(
  storage: StorageDriver,
  storageKey: string,
): Promise<StoredBlogKeyImage> {
  const variants: StoredBlogKeyImage['variants'] = {} as StoredBlogKeyImage['variants'];

  for (const preset of variantPresets) {
    const variantKey = buildSiblingVariantStorageKey(
      storageKey,
      preset.name,
      preset.format === 'jpeg' ? 'jpeg' : 'webp',
    );

    if (await storageObjectExists(storage, variantKey)) {
      variants[preset.name] = {
        storageKey: variantKey,
        url: storage.publicUrl(variantKey),
        mimeType: preset.format === 'jpeg' ? OUTPUT_MIME_TYPES.jpeg : OUTPUT_MIME_TYPES.webp,
        width: preset.width ?? 0,
        height: 'height' in preset ? (preset.height ?? 0) : 0,
        size: 0,
      };
    }
  }

  return {
    storageKey,
    rawUrl: storage.publicUrl(storageKey),
    uploaded: false,
    width: null,
    height: null,
    mimeType: 'image/webp',
    size: 0,
    isAnimated: false,
    variants,
  };
}

export async function processAndStoreAtKey(input: {
  storageKey: string;
  buffer: Buffer;
  mimeType: string;
  storage: StorageDriver;
  force?: boolean;
}): Promise<StoredBlogKeyImage> {
  assertSafeStorageKey(input.storageKey);

  if (input.mimeType.startsWith('video/')) {
    throw new ImageProcessingError('Video uploads are not supported on the service image route', 400);
  }

  if (!input.mimeType.startsWith('image/')) {
    throw new ImageProcessingError('Only image uploads are supported', 400);
  }

  const exists = await storageObjectExists(input.storage, input.storageKey);
  if (exists && !input.force) {
    return buildExistingResponse(input.storage, input.storageKey);
  }

  const metadata = await sharp(input.buffer, { animated: true }).metadata();
  const isAnimated = Boolean(metadata.pages && metadata.pages > 1);

  const generatedVariants: GeneratedVariantFile[] =
    !isAnimated && metadata.width && metadata.height
      ? await Promise.all(
          variantPresets.map((preset) =>
            generateStaticVariantAtKey(input.buffer, preset, input.storageKey),
          ),
        )
      : [];

  const filesToStore = [
    {
      key: input.storageKey,
      mimeType: input.mimeType,
      body: input.buffer,
    },
    ...generatedVariants.map(({ key, mimeType, body }) => ({ key, mimeType, body })),
  ];

  const storedKeys: string[] = [];

  try {
    for (const file of filesToStore) {
      await input.storage.put({
        key: file.key,
        mimeType: file.mimeType,
        body: file.body,
      });
      storedKeys.push(file.key);
    }
  } catch (error) {
    await Promise.allSettled(storedKeys.map((key) => input.storage.delete(key)));
    throw error;
  }

  const variants = Object.fromEntries(
    generatedVariants.map((variant) => [
      variant.variant,
      {
        storageKey: variant.key,
        url: input.storage.publicUrl(variant.key),
        mimeType: variant.mimeType,
        width: variant.width,
        height: variant.height,
        size: variant.body.length,
      },
    ]),
  ) as StoredBlogKeyImage['variants'];

  return {
    storageKey: input.storageKey,
    rawUrl: input.storage.publicUrl(input.storageKey),
    uploaded: true,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    mimeType: input.mimeType,
    size: input.buffer.length,
    isAnimated,
    variants,
  };
}
