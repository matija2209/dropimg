import { Hono } from 'hono';
import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import { storage, config } from '../config.js';
import { serializeImageAsset } from '../lib/image-assets.js';
import { processAndStoreImage } from '../services/image-processing.js';

const upload = new Hono();

upload.post('/', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'] as File;
  const altName = body['altName'] as string;

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  if (!config.allowedTypes.includes(file.type)) {
    return c.json({ error: `File type ${file.type} not allowed` }, 400);
  }

  if (file.size > config.maxUploadMb * 1024 * 1024) {
    return c.json({ error: `File size exceeds ${config.maxUploadMb}MB limit` }, 400);
  }

  const id = Math.random().toString(36).substring(2, 10);
  const deleteToken = Math.random().toString(36).substring(2, 15);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const processed = await processAndStoreImage({
    id,
    fileName: file.name,
    mimeType: file.type,
    buffer,
    storage,
  });

  try {
    db.transaction((tx) => {
      tx.insert(images).values({
        id,
        filename: processed.original.storageKey,
        altName: altName || null,
        mimeType: processed.original.mimeType,
        size: processed.original.size,
        width: processed.original.width,
        height: processed.original.height,
        isAnimated: processed.isAnimated,
        deleteToken,
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

  return c.json({
    ...serializeImageAsset({
      id,
      filename: processed.original.storageKey,
      altName: altName || null,
      mimeType: processed.original.mimeType,
      size: processed.original.size,
      width: processed.original.width,
      height: processed.original.height,
      isAnimated: processed.isAnimated,
      deleteToken,
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
    }),
    pageUrl: `${config.appUrl}/i/${id}`,
    deleteUrl: `${config.appUrl}/api/images/${id}?token=${deleteToken}`,
  });
});

export default upload;
