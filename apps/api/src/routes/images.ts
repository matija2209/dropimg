import { Hono } from 'hono';
import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { storage, config } from '../config.js';
import { serializeImageAsset } from '../lib/image-assets.js';
import { authMiddleware } from '../lib/middleware.js';
import type { VariantName } from '../services/image-processing.js';
import type { auth } from '../lib/auth.js';

const imagesRoute = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user;
    session: typeof auth.$Infer.Session.session;
  };
}>();

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

// Get responsive HTML snippet
imagesRoute.get('/:id/responsive', async (c) => {
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

  const serialized = serializeImageAsset(image);
  
  if (c.req.query('format') === 'json') {
    return c.json({ html: serialized.responsiveHtml });
  }

  return c.text(serialized.responsiveHtml);
});

// Smart responsive auto-serving
imagesRoute.get('/:id/auto', async (c) => {
  const image = await db.query.images.findFirst({
    where: eq(images.id, c.req.param('id')),
    with: {
      variants: true,
    },
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  // Content Negotiation / Client Hints
  const viewportWidth = parseInt(c.req.header('Sec-CH-Viewport-Width') || '0', 10);
  const dpr = parseFloat(c.req.header('Sec-CH-DPR') || '1');
  const targetWidth = viewportWidth > 0 ? viewportWidth * dpr : 0;

  let resolved = {
    variant: 'original' as VariantName,
    storageKey: image.filename,
    mimeType: image.mimeType,
  };

  if (targetWidth > 0 && image.variants.length > 0) {
    // Find the smallest variant that is >= targetWidth
    const sortedVariants = [...image.variants]
      .filter(v => v.width)
      .sort((a, b) => (a.width || 0) - (b.width || 0));
    
    const bestVariant = sortedVariants.find(v => (v.width || 0) >= targetWidth) || sortedVariants[sortedVariants.length - 1];
    
    if (bestVariant) {
      resolved = {
        variant: bestVariant.variant as VariantName,
        storageKey: bestVariant.storageKey,
        mimeType: bestVariant.mimeType,
      };
    }
  }

  try {
    const { body, mimeType } = await storage.get(resolved.storageKey);

    return c.body(body, 200, {
      'Content-Type': mimeType || resolved.mimeType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600', // Shorter cache for auto-serving
      'Vary': 'Sec-CH-Viewport-Width, Sec-CH-DPR',
    });
  } catch (error) {
    return c.notFound();
  }
});

// List all images (Filtered by user unless admin)
imagesRoute.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  
  const allImages = await db.query.images.findMany({
    where: user.role === 'admin' ? undefined : eq(images.userId, user.id),
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

// Delete image (Permission check: owner or admin)
imagesRoute.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
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

  // Allow delete if:
  // 1. Correct delete token is provided (stateless)
  // 2. User is the owner
  // 3. User is an admin
  const isOwner = image.userId === user.id;
  const isAdmin = user.role === 'admin';
  const hasToken = token === image.deleteToken || token === config.adminToken;

  if (!hasToken && !isOwner && !isAdmin) {
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
  image: any,
  requestedVariant: string
) {
  if (requestedVariant === 'original') {
    return {
      variant: 'original' as VariantName,
      storageKey: image.filename,
      mimeType: image.mimeType,
    };
  }

  const variant = image.variants.find((entry: any) => entry.variant === requestedVariant);

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
