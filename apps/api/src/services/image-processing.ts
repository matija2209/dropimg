import sharp from 'sharp';
import { extname } from 'node:path';
import type { StorageDriver } from '../storage/types.js';

export const variantPresets = [
  {
    name: 'thumbnail',
    width: 320,
    height: 320,
    strategy: 'contain-within',
    format: 'webp',
  },
  {
    name: 'card',
    width: 640,
    height: 360,
    strategy: 'blurred-canvas',
    format: 'webp',
  },
  {
    name: 'tablet',
    width: 1024,
    strategy: 'max-width',
    format: 'webp',
  },
  {
    name: 'social',
    width: 1200,
    height: 630,
    strategy: 'blurred-canvas',
    format: 'jpeg',
  },
] as const;

export type StaticVariantName = (typeof variantPresets)[number]['name'];
export type VariantName = StaticVariantName | 'original';

type VariantOutput = {
  variant: StaticVariantName;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

export type ProcessedImage = {
  original: {
    storageKey: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  };
  isAnimated: boolean;
  variants: VariantOutput[];
};

type GeneratedFile = {
  key: string;
  mimeType: string;
  body: Buffer;
};

type GeneratedVariantFile = GeneratedFile & {
  variant: StaticVariantName;
  width: number;
  height: number;
};

const OUTPUT_MIME_TYPES = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

const ORIGINAL_EXTENSION_BY_MIME: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export async function processAndStoreImage(input: {
  id: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  storage: StorageDriver;
}): Promise<ProcessedImage> {
  const metadata = await sharp(input.buffer, { animated: true }).metadata();
  const width = metadata.width ?? null;
  const height = metadata.height ?? null;
  const isAnimated = (metadata.pages ?? 1) > 1;
  const generatedVariants: GeneratedVariantFile[] =
    !isAnimated && width && height
      ? await Promise.all(
          variantPresets.map((preset) => generateStaticVariant(input.id, input.buffer, preset))
        )
      : [];
  const generatedFiles: GeneratedFile[] = [
    {
      key: `${input.id}/original${getOriginalExtension(input.mimeType, input.fileName)}`,
      mimeType: input.mimeType,
      body: input.buffer,
    },
    ...generatedVariants.map(({ key, mimeType, body }) => ({ key, mimeType, body })),
  ];

  const storedKeys: string[] = [];

  try {
    for (const file of generatedFiles) {
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

  const variants = !isAnimated && width && height
    ? generatedVariants.map((variant) => ({
        variant: variant.variant,
        storageKey: variant.key,
        mimeType: variant.mimeType,
        size: variant.body.length,
        width: variant.width,
        height: variant.height,
      }))
    : [];

  return {
    original: {
      storageKey: generatedFiles[0].key,
      mimeType: input.mimeType,
      size: input.buffer.length,
      width,
      height,
    },
    isAnimated,
    variants,
  };
}

async function generateStaticVariant(
  id: string,
  sourceBuffer: Buffer,
  preset: (typeof variantPresets)[number]
): Promise<GeneratedVariantFile> {
  const pipeline = sharp(sourceBuffer).rotate();
  const key = `${id}/${preset.name}.${preset.format === 'jpeg' ? 'jpg' : preset.format}`;

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

function getOriginalExtension(mimeType: string, fileName: string): string {
  const byMime = ORIGINAL_EXTENSION_BY_MIME[mimeType];
  if (byMime) {
    return byMime;
  }

  const fileExtension = extname(fileName).toLowerCase();
  return fileExtension || '.bin';
}
