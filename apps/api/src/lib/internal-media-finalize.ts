import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import { config, storage } from '../config.js';
import { serializeImageAsset } from './image-assets.js';
import { VideoProcessingError, processStagedVideo } from '../services/video-processing.js';
import type { StagedUpload } from './staged-upload.js';
import { auth } from './auth.js';

export type DropimgVideosFinalizePayload = {
  pipeline: 'dropimg-videos';
  stagedUpload: StagedUpload;
  altName?: string;
  transcode?: boolean;
  userId?: string;
};

export async function finalizeDropimgVideoUpload(
  payload: DropimgVideosFinalizePayload,
  userId: string | null
): Promise<Record<string, unknown>> {
  if (!config.videoUploadsEnabled) {
    throw new VideoProcessingError('Video uploads are disabled on this server.', 503);
  }

  const id = Math.random().toString(36).substring(2, 10);
  const deleteToken = Math.random().toString(36).substring(2, 15);
  const altName = payload.altName?.trim() || null;

  const processed = await processStagedVideo({
    id,
    staged: payload.stagedUpload,
    altName: altName ?? undefined,
    transcode: payload.transcode === true,
    storage,
  });

  try {
    db.transaction((tx) => {
      tx.insert(images).values({
        id,
        filename: processed.original.storageKey,
        altName,
        mimeType: processed.original.mimeType,
        mediaType: 'video',
        size: processed.original.size,
        width: processed.original.width,
        height: processed.original.height,
        durationMs: processed.durationMs,
        transcoded: processed.transcoded,
        originalSize: processed.originalSize,
        isAnimated: false,
        deleteToken,
        userId,
        source: 'upload',
        createdAt: new Date(),
      }).run();

      if (processed.variants.length > 0) {
        tx.insert(imageVariants).values(
          processed.variants.map((variant) => ({
            imageId: id,
            variant: variant.variant,
            storageKey: variant.storageKey,
            mimeType: variant.mimeType,
            size: variant.size,
            width: variant.width,
            height: variant.height,
          }))
        ).run();
      }
    });
  } catch (error) {
    await Promise.allSettled([
      storage.delete(processed.original.storageKey),
      ...processed.variants.map((variant) => storage.delete(variant.storageKey)),
    ]);
    throw error;
  }

  const asset = serializeImageAsset({
    id,
    filename: processed.original.storageKey,
    altName,
    mimeType: processed.original.mimeType,
    mediaType: 'video',
    size: processed.original.size,
    width: processed.original.width,
    height: processed.original.height,
    durationMs: processed.durationMs,
    transcoded: processed.transcoded,
    originalSize: processed.originalSize,
    isAnimated: false,
    deleteToken,
    userId,
    source: 'upload',
    createdAt: new Date(),
    variants: processed.variants.map((variant) => ({
      imageId: id,
      variant: variant.variant,
      storageKey: variant.storageKey,
      mimeType: variant.mimeType,
      size: variant.size,
      width: variant.width,
      height: variant.height,
    })),
  });

  return {
    ...asset,
    pageUrl: `${config.appUrl}/i/${id}`,
    deleteUrl: `${config.appUrl}/api/images/${id}?token=${deleteToken}`,
    processing: processed.processing,
  };
}

export async function dispatchInternalMediaFinalize(
  payload: Record<string, unknown>,
  headers: Headers
): Promise<Record<string, unknown>> {
  const pipeline = payload.pipeline;
  if (pipeline !== 'dropimg-videos') {
    throw new VideoProcessingError(`Unknown pipeline: ${String(pipeline)}`, 400);
  }

  const stagedUpload = payload.stagedUpload as StagedUpload | undefined;
  if (!stagedUpload?.s3Key) {
    throw new VideoProcessingError('stagedUpload is required.', 400);
  }

  let userId: string | null = typeof payload.userId === 'string' ? payload.userId : null;

  if (!userId) {
    const session = await auth.api.getSession({ headers });
    userId = session?.user?.id ?? null;
  }

  if (!userId && !config.publicMode) {
    throw new VideoProcessingError('Authentication required for video upload.', 401);
  }

  return finalizeDropimgVideoUpload(
    {
      pipeline: 'dropimg-videos',
      stagedUpload,
      altName: typeof payload.altName === 'string' ? payload.altName : undefined,
      transcode: payload.transcode === true,
      userId: userId ?? undefined,
    },
    userId
  );
}
