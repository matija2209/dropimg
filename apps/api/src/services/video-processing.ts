import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { config } from '../config.js';
import { isVideoMime, resolveVideoMimeType } from '../lib/file-mime.js';
import { assertTvReadyOutput } from '../lib/media/ffprobe-codec.js';
import { probeVideoFile } from '../lib/media/ffprobe-video.js';
import { runFfmpegPosterFrame, runFfmpegTranscode } from '../lib/media/transcode-video.js';
import { downloadStagedToFile, type StagedUpload } from '../lib/staged-upload.js';
import type { StorageDriver } from '../storage/types.js';

export type VideoVariantName = 'original' | 'poster';

export class VideoProcessingError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'VideoProcessingError';
    this.statusCode = statusCode;
  }
}

export type ProcessedVideo = {
  original: {
    storageKey: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  };
  variants: Array<{
    variant: VideoVariantName;
    storageKey: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
  }>;
  durationMs: number | null;
  transcoded: boolean;
  originalSize: number | null;
  processing: {
    mode: 'video';
    sourceMimeType: string;
    sourceSize: number;
    outputMimeType: string;
    outputSize: number;
    transcoded: boolean;
  };
};

export async function processStagedVideo(input: {
  id: string;
  staged: StagedUpload;
  altName?: string;
  transcode: boolean;
  storage: StorageDriver;
}): Promise<ProcessedVideo> {
  if (config.storageDriver !== 's3') {
    throw new VideoProcessingError('Chunked video uploads require S3 storage (STORAGE_DRIVER=s3).', 503);
  }

  const mimeType = resolveVideoMimeType(input.staged.fileName, input.staged.mimeType);
  if (!isVideoMime(mimeType)) {
    throw new VideoProcessingError(`File type ${mimeType} is not a supported video format.`);
  }

  const shouldTranscode = input.transcode && config.videoTranscodeEnabled;
  const tmpDir = await mkdtemp(join(tmpdir(), 'dropimg-vid-'));
  const inputExt = extname(input.staged.fileName) || '.mp4';
  const inputPath = join(tmpDir, `in${inputExt}`);
  const transcodePath = join(tmpDir, 'out.mp4');
  const posterFramePath = join(tmpDir, 'poster.jpg');

  try {
    await downloadStagedToFile(input.staged, inputPath);

    let workingPath = inputPath;
    let outputMime = mimeType;
    let transcoded = false;

    if (shouldTranscode) {
      await runFfmpegTranscode(inputPath, transcodePath);
      await assertTvReadyOutput(transcodePath);
      workingPath = transcodePath;
      outputMime = 'video/mp4';
      transcoded = true;
    }

    const probe = await probeVideoFile(workingPath);
    const videoBuffer = await readFile(workingPath);
    const originalExt = transcoded ? '.mp4' : inputExt;
    const originalKey = `${input.id}/original${originalExt}`;

    await input.storage.put({
      key: originalKey,
      body: videoBuffer,
      mimeType: outputMime,
    });

    const variants: ProcessedVideo['variants'] = [];

    try {
      await runFfmpegPosterFrame(workingPath, posterFramePath);
      const posterWebp = await sharp(await readFile(posterFramePath))
        .webp({ quality: 82 })
        .toBuffer();
      const posterMeta = await sharp(posterWebp).metadata();
      const posterKey = `${input.id}/poster.webp`;

      await input.storage.put({
        key: posterKey,
        body: posterWebp,
        mimeType: 'image/webp',
      });

      variants.push({
        variant: 'poster',
        storageKey: posterKey,
        mimeType: 'image/webp',
        size: posterWebp.length,
        width: posterMeta.width ?? probe?.width ?? 0,
        height: posterMeta.height ?? probe?.height ?? 0,
      });
    } catch (error) {
      console.warn('[video] poster extraction failed:', error);
    }

    return {
      original: {
        storageKey: originalKey,
        mimeType: outputMime,
        size: videoBuffer.length,
        width: probe?.width ?? null,
        height: probe?.height ?? null,
      },
      variants,
      durationMs: probe?.durationMs ?? null,
      transcoded,
      originalSize: transcoded ? input.staged.fileSize : null,
      processing: {
        mode: 'video',
        sourceMimeType: mimeType,
        sourceSize: input.staged.fileSize,
        outputMimeType: outputMime,
        outputSize: videoBuffer.length,
        transcoded,
      },
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
