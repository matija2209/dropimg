import { Hono } from 'hono';
import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { storage, config } from '../config.js';
import { serializeImageAsset } from '../lib/image-assets.js';

const imagesRoute = new Hono();

imagesRoute.get('/:id/file/:variant', async (c) => {
  const id = c.req.param('id');
  const requestedVariant = c.req.param('variant');
  const image = await db.query.images.findFirst({
    where: eq(images.id, id),
    with: {
      variants: true,
    },
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const storageKey =
    requestedVariant === 'original'
      ? image.filename
      : image.variants.find((variant) => variant.variant === requestedVariant)?.storageKey;

  if (!storageKey) {
    return c.json({ error: 'Variant not found' }, 404);
  }

  try {
    const { body, mimeType } = await storage.get(storageKey);

    return c.body(body, 200, {
      'Content-Type': mimeType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  } catch (error) {
    return c.notFound();
  }
});

// List all images
imagesRoute.get('/', async (c) => {
  const allImages = await db.query.images.findMany({
    orderBy: (images, { desc }) => [desc(images.createdAt)],
    with: {
      variants: true,
    },
  });

  return c.json(allImages.map((image) => serializeImageAsset(image)));
});

// Get metadata
imagesRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const image = await db.query.images.findFirst({
    where: eq(images.id, id),
    with: {
      variants: true,
    },
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return c.json(serializeImageAsset(image));
});

// Delete image
imagesRoute.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');

  const image = await db.query.images.findFirst({
    where: eq(images.id, id),
    with: {
      variants: true,
    },
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  if (token !== image.deleteToken && token !== config.adminToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await Promise.allSettled([
    storage.delete(image.filename),
    ...image.variants.map((variant) => storage.delete(variant.storageKey)),
  ]);
  db.transaction((tx) => {
    tx.delete(imageVariants).where(eq(imageVariants.imageId, id)).run();
    tx.delete(images).where(eq(images.id, id)).run();
  });

  return c.json({ success: true });
});

export default imagesRoute;
