import { Hono } from 'hono';
import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { storage, config } from '../config.js';
import { serializeImageAsset } from '../lib/image-assets.js';
import type { VariantName } from '../services/image-processing.js';

const imagesRoute = new Hono();

imagesRoute.get('/:id/base64/:variant', async (c) => {
  const image = await db.query.images.findFirst({
    where: eq(images.id, c.req.param('id')),
    with: {
      variants: true,
    },
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const resolved = resolveVariant(image, c.req.param('variant'));

  if (!resolved) {
    return c.json({ error: 'Variant not found' }, 404);
  }

  try {
    const { body, mimeType } = await storage.get(resolved.storageKey);
    const buffer = await readBodyToBuffer(body);

    return c.json({
      variant: resolved.variant,
      mimeType: mimeType || resolved.mimeType || 'application/octet-stream',
      dataUrl: `data:${mimeType || resolved.mimeType || 'application/octet-stream'};base64,${buffer.toString('base64')}`,
    });
  } catch (error) {
    return c.notFound();
  }
});

imagesRoute.get('/:id/file/:variant', async (c) => {
  const image = await db.query.images.findFirst({
    where: eq(images.id, c.req.param('id')),
    with: {
      variants: true,
    },
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const resolved = resolveVariant(image, c.req.param('variant'));

  if (!resolved) {
    return c.json({ error: 'Variant not found' }, 404);
  }

  try {
    const { body, mimeType } = await storage.get(resolved.storageKey);

    return c.body(body, 200, {
      'Content-Type': mimeType || resolved.mimeType || 'application/octet-stream',
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

function resolveVariant(
  image: Awaited<ReturnType<typeof db.query.images.findFirst>> & { variants: typeof imageVariants.$inferSelect[] },
  requestedVariant: string
) {
  if (requestedVariant === 'original') {
    return {
      variant: 'original' as VariantName,
      storageKey: image.filename,
      mimeType: image.mimeType,
    };
  }

  const variant = image.variants.find((entry) => entry.variant === requestedVariant);

  if (!variant) {
    return null;
  }

  return {
    variant: variant.variant as VariantName,
    storageKey: variant.storageKey,
    mimeType: variant.mimeType,
  };
}

async function readBodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];

    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  throw new Error('Unsupported body type');
}

export default imagesRoute;
