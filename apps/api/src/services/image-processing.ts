import sharp from 'sharp';
import { extname } from 'node:path';
import { spawn } from 'node:child_process';
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
export const uploadModes = ['upload', 'compress-jpg', 'png-to-jpg', 'strip-metadata', 'remove-background'] as const;
export type UploadMode = (typeof uploadModes)[number];
type QualityMode = keyof typeof QUALITY_BY_MODE;

type VariantOutput = {
  variant: StaticVariantName;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

export type ProcessingSummary = {
  mode: UploadMode;
  sourceMimeType: string;
  sourceSize: number;
  outputMimeType: string;
  outputSize: number;
  savedBytes: number;
  savedPercent: number;
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
  processing: ProcessingSummary;
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

type QualityRange = {
  min: number;
  max: number;
  default: number;
};

type TransformResult = {
  buffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  isAnimated: boolean;
};

const OUTPUT_MIME_TYPES = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

const ORIGINAL_EXTENSION_BY_MIME: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MIME_TYPE_BY_SHARP_FORMAT: Record<string, string> = {
  gif: 'image/gif',
  heif: 'image/heif',
  jpeg: OUTPUT_MIME_TYPES.jpeg,
  jpg: OUTPUT_MIME_TYPES.jpeg,
  png: OUTPUT_MIME_TYPES.png,
  webp: OUTPUT_MIME_TYPES.webp,
};

const BACKGROUND_REMOVAL_INPUT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const QUALITY_BY_MODE = {
  'compress-jpg': {
    min: 60,
    max: 92,
    default: 82,
  },
  'png-to-jpg': {
    min: 70,
    max: 95,
    default: 90,
  },
  'strip-metadata': {
    min: 80,
    max: 100,
    default: 100,
  },
} as const satisfies Record<'compress-jpg' | 'png-to-jpg' | 'strip-metadata', QualityRange>;

export class ImageProcessingError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ImageProcessingError';
    this.statusCode = statusCode;
  }
}

export async function processAndStoreImage(input: {
  id: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  mode: UploadMode;
  quality?: number;
  backgroundRemoval?: {
    apiKey?: string;
    apiUrl?: string;
    outputFormat?: string;
  };
  storage: StorageDriver;
}): Promise<ProcessedImage> {
  const sourceMetadata = await sharp(input.buffer, { animated: true }).metadata();
  const transformed = await transformCanonicalImage({
    buffer: input.buffer,
    mimeType: input.mimeType,
    mode: input.mode,
    quality: input.quality,
    metadata: sourceMetadata,
    fileName: input.fileName,
    backgroundRemoval: input.backgroundRemoval,
  });
  const generatedVariants: GeneratedVariantFile[] =
    !transformed.isAnimated && transformed.width && transformed.height
      ? await Promise.all(
          variantPresets.map((preset) => generateStaticVariant(input.id, transformed.buffer, preset))
        )
      : [];
  const generatedFiles: GeneratedFile[] = [
    {
      key: `${input.id}/original${getOriginalExtension(transformed.mimeType, input.fileName)}`,
      mimeType: transformed.mimeType,
      body: transformed.buffer,
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

  const variants = !transformed.isAnimated && transformed.width && transformed.height
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
      mimeType: transformed.mimeType,
      size: transformed.buffer.length,
      width: transformed.width,
      height: transformed.height,
    },
    isAnimated: transformed.isAnimated,
    variants,
    processing: buildProcessingSummary({
      mode: input.mode,
      sourceMimeType: input.mimeType,
      sourceSize: input.buffer.length,
      outputMimeType: transformed.mimeType,
      outputSize: transformed.buffer.length,
    }),
  };
}

async function transformCanonicalImage(input: {
  buffer: Buffer;
  mimeType: string;
  mode: UploadMode;
  quality?: number;
  metadata: sharp.Metadata;
  fileName: string;
  backgroundRemoval?: {
    apiKey?: string;
    apiUrl?: string;
    outputFormat?: string;
  };
}): Promise<TransformResult> {
  const width = input.metadata.width ?? null;
  const height = input.metadata.height ?? null;
  const isAnimated = (input.metadata.pages ?? 1) > 1;

  if (input.mode === 'upload') {
    return {
      buffer: input.buffer,
      mimeType: input.mimeType,
      width,
      height,
      isAnimated,
    };
  }

  if (input.mode === 'strip-metadata') {
    const stripped = await stripMetadata(input.buffer);
    const newMetadata = await sharp(stripped).metadata();
    return {
      buffer: stripped,
      mimeType: input.mimeType,
      width: newMetadata.width ?? width,
      height: newMetadata.height ?? height,
      isAnimated,
    };
  }

  if (input.mode === 'remove-background') {
    if (!BACKGROUND_REMOVAL_INPUT_MIME_TYPES.has(input.mimeType)) {
      throw new ImageProcessingError('Background removal only accepts PNG, JPG, and WEBP uploads.');
    }

    if (isAnimated) {
      throw new ImageProcessingError('Animated image uploads are not supported for background removal.');
    }

    const removed = await removeBackgroundWithPhotoroom({
      buffer: input.buffer,
      fileName: input.fileName,
      mimeType: input.mimeType,
      apiKey: input.backgroundRemoval?.apiKey,
      apiUrl: input.backgroundRemoval?.apiUrl,
      outputFormat: input.backgroundRemoval?.outputFormat,
    });
    const removedMetadata = await sharp(removed.buffer).metadata();

    return {
      buffer: removed.buffer,
      mimeType: removed.mimeType,
      width: removedMetadata.width ?? width,
      height: removedMetadata.height ?? height,
      isAnimated: false,
    };
  }

  if (input.mode === 'compress-jpg') {
    if (input.mimeType !== 'image/jpeg') {
      throw new ImageProcessingError('Compress JPG mode only accepts JPG uploads.');
    }

    if (isAnimated) {
      throw new ImageProcessingError('Animated JPG uploads cannot be compressed in this mode.');
    }

    const quality = resolveQuality(input.mode, input.quality);
    const { data, info } = await sharp(input.buffer)
      .rotate()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    if (data.length >= input.buffer.length) {
      return {
        buffer: input.buffer,
        mimeType: input.mimeType,
        width,
        height,
        isAnimated: false,
      };
    }

    return {
      buffer: data,
      mimeType: OUTPUT_MIME_TYPES.jpeg,
      width: info.width,
      height: info.height,
      isAnimated: false,
    };
  }

  if (input.mimeType !== 'image/png') {
    throw new ImageProcessingError('PNG to JPG mode only accepts PNG uploads.');
  }

  if (isAnimated) {
    throw new ImageProcessingError('Animated PNG uploads are not supported for PNG to JPG conversion.');
  }

  const quality = resolveQuality('png-to-jpg', input.quality);
  const { data, info } = await sharp(input.buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mimeType: OUTPUT_MIME_TYPES.jpeg,
    width: info.width,
    height: info.height,
    isAnimated: false,
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

function resolveQuality(mode: QualityMode, quality?: number): number {
  const config = QUALITY_BY_MODE[mode];

  if (quality === undefined || Number.isNaN(quality)) {
    return config.default;
  }

  if (!Number.isInteger(quality) || quality < config.min || quality > config.max) {
    throw new ImageProcessingError(
      `${describeMode(mode)} quality must be an integer between ${config.min} and ${config.max}.`
    );
  }

  return quality;
}

function buildProcessingSummary(input: {
  mode: UploadMode;
  sourceMimeType: string;
  sourceSize: number;
  outputMimeType: string;
  outputSize: number;
}): ProcessingSummary {
  const savedBytes = Math.max(0, input.sourceSize - input.outputSize);
  const savedPercent =
    input.sourceSize > 0 ? Math.round((savedBytes / input.sourceSize) * 1000) / 10 : 0;

  return {
    mode: input.mode,
    sourceMimeType: input.sourceMimeType,
    sourceSize: input.sourceSize,
    outputMimeType: input.outputMimeType,
    outputSize: input.outputSize,
    savedBytes,
    savedPercent,
  };
}

function describeMode(mode: QualityMode): string {
  if (mode === 'strip-metadata') {
    return 'Strip Metadata';
  }
  return mode === 'compress-jpg' ? 'Compress JPG' : 'PNG to JPG';
}

async function removeBackgroundWithPhotoroom(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  apiKey?: string;
  apiUrl?: string;
  outputFormat?: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!input.apiKey) {
    throw new ImageProcessingError('Background removal is not configured on this server.', 500);
  }

  const formData = new FormData();
  formData.append(
    'image_file',
    new Blob([Uint8Array.from(input.buffer)], { type: input.mimeType }),
    input.fileName || 'image'
  );

  if (input.outputFormat && ['png', 'webp'].includes(input.outputFormat)) {
    formData.append('output_format', input.outputFormat);
  }

  let response: Response;

  try {
    response = await fetch(input.apiUrl || 'https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: {
        'x-api-key': input.apiKey,
      },
      body: formData,
    });
  } catch {
    throw new ImageProcessingError('Background removal provider could not be reached.', 502);
  }

  if (!response.ok) {
    throw new ImageProcessingError(
      `Background removal failed with provider status ${response.status}.`,
      response.status >= 500 ? 502 : 400
    );
  }

  const outputBuffer = Buffer.from(await response.arrayBuffer());
  const mimeType = await resolveOutputMimeType(outputBuffer, response.headers.get('content-type'));

  return {
    buffer: outputBuffer,
    mimeType,
  };
}

async function resolveOutputMimeType(buffer: Buffer, contentTypeHeader: string | null): Promise<string> {
  const headerMimeType = contentTypeHeader?.split(';', 1)[0]?.trim();

  if (headerMimeType?.startsWith('image/')) {
    return headerMimeType;
  }

  const metadata = await sharp(buffer).metadata();
  const byFormat = metadata.format ? MIME_TYPE_BY_SHARP_FORMAT[metadata.format] : undefined;

  if (byFormat) {
    return byFormat;
  }

  return OUTPUT_MIME_TYPES.png;
}

async function stripMetadata(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  const format = metadata.format;

  return new Promise((resolve) => {
    const child = spawn('exiftool', ['-all=', '-o', '-', '-']);
    const chunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => {
      // If exiftool is not found, fallback to sharp
      fallbackToSharp(buffer, format).then(resolve);
    });

    child.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        // Fallback to sharp
        fallbackToSharp(buffer, format).then(resolve);
      }
    });

    child.stdin.write(buffer);
    child.stdin.end();
  });
}

async function fallbackToSharp(buffer: Buffer, format?: string): Promise<Buffer> {
  try {
    let pipeline = sharp(buffer).rotate();

    if (format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
    } else if (format === 'png') {
      pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 85 });
    }

    const stripped = await pipeline.toBuffer();
    
    // If the "stripped" version is significantly larger (more than 20% increase), 
    // it's likely a poor conversion. 
    if (stripped.length > buffer.length * 1.2) {
      return buffer;
    }

    return stripped;
  } catch {
    return buffer;
  }
}
