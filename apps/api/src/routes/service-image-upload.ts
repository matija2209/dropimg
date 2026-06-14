import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { config, storage } from '../config.js';
import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import {
  buildServiceImageId,
  processAndStoreAtKey,
} from '../services/blog-key-image-processing.js';
import { ImageProcessingError } from '../services/image-processing.js';

const serviceImageUpload = new Hono();

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function verifyServiceAuth(authHeader: string): boolean {
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!config.internalUploadSecret) {
    return false;
  }

  return bearer === config.internalUploadSecret;
}

serviceImageUpload.post('/', async (c) => {
  if (!verifyServiceAuth(c.req.header('Authorization') ?? '')) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const storageKey = typeof payload.storageKey === 'string' ? payload.storageKey.trim() : '';
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim() : '';
  const imageBase64 = typeof payload.imageBase64 === 'string' ? payload.imageBase64.trim() : '';
  const alt = typeof payload.alt === 'string' ? payload.alt.trim() : '';
  const force = payload.force === true;

  if (!storageKey || !mimeType || !imageBase64) {
    return c.json(
      { ok: false, error: 'storageKey, mimeType, and imageBase64 are required' },
      400,
    );
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return c.json({ ok: false, error: `Unsupported mimeType: ${mimeType}` }, 400);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(imageBase64, 'base64');
  } catch {
    return c.json({ ok: false, error: 'imageBase64 is not valid base64' }, 400);
  }

  if (buffer.length === 0) {
    return c.json({ ok: false, error: 'Image payload is empty' }, 400);
  }

  if (buffer.length > config.maxUploadMb * 1024 * 1024) {
    return c.json({ ok: false, error: `File size exceeds ${config.maxUploadMb}MB limit` }, 400);
  }

  try {
    const processed = await processAndStoreAtKey({
      storageKey,
      buffer,
      mimeType,
      storage,
      force,
    });

    if (!processed.uploaded) {
      const existingImage = await db.query.images.findFirst({
        where: eq(images.filename, storageKey),
        with: { variants: true },
      });

      if (existingImage) {
        const variants = Object.fromEntries(
          (existingImage.variants ?? []).map((variant) => [
            variant.variant,
            {
              storageKey: variant.storageKey,
              url: storage.publicUrl(variant.storageKey),
              mimeType: variant.mimeType,
              width: variant.width,
              height: variant.height,
              size: variant.size,
            },
          ]),
        );

        return c.json({
          ok: true,
          storageKey: processed.storageKey,
          rawUrl: processed.rawUrl,
          uploaded: false,
          width: existingImage.width,
          height: existingImage.height,
          mimeType: existingImage.mimeType,
          size: existingImage.size,
          variants,
        });
      }
    }

    const imageId = buildServiceImageId(storageKey);
    const deleteToken = buildServiceImageId(`${storageKey}:delete`);

    db.transaction((tx) => {
      const existing = tx
        .select({ id: images.id })
        .from(images)
        .where(eq(images.filename, storageKey))
        .get();

      if (existing) {
        tx.update(images)
          .set({
            altName: alt || null,
            mimeType: processed.mimeType,
            size: processed.size,
            width: processed.width,
            height: processed.height,
            isAnimated: processed.isAnimated,
            source: 'service',
          })
          .where(eq(images.id, existing.id))
          .run();

        tx.delete(imageVariants).where(eq(imageVariants.imageId, existing.id)).run();
      } else {
        tx.insert(images)
          .values({
            id: imageId,
            filename: storageKey,
            altName: alt || null,
            mimeType: processed.mimeType,
            mediaType: 'image',
            size: processed.size,
            width: processed.width,
            height: processed.height,
            isAnimated: processed.isAnimated,
            deleteToken,
            userId: null,
            source: 'service',
            createdAt: new Date(),
          })
          .run();
      }

      const targetId = existing?.id ?? imageId;
      const variantRows = Object.entries(processed.variants).map(([variant, entry]) => ({
        imageId: targetId,
        variant,
        storageKey: entry.storageKey,
        mimeType: entry.mimeType,
        size: entry.size,
        width: entry.width,
        height: entry.height,
      }));

      if (variantRows.length > 0) {
        tx.insert(imageVariants).values(variantRows).run();
      }
    });

    return c.json({
      ok: true,
      storageKey: processed.storageKey,
      rawUrl: processed.rawUrl,
      uploaded: processed.uploaded,
      width: processed.width,
      height: processed.height,
      mimeType: processed.mimeType,
      size: processed.size,
      variants: processed.variants,
    });
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      return c.json({ ok: false, error: error.message }, error.statusCode as 400);
    }

    console.error('[service-image-upload]', error);
    return c.json({ ok: false, error: 'Upload failed' }, 500);
  }
});

export default serviceImageUpload;
