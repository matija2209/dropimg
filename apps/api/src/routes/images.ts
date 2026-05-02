import { Hono } from 'hono';
import { db } from '../db/client.js';
import { images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { storage, config } from '../config.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const imagesRoute = new Hono();

// Get metadata
imagesRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const image = await db.query.images.findFirst({
    where: eq(images.id, id),
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return c.json({
    ...image,
    directUrl: storage.publicUrl(image.filename),
  });
});

// Delete image
imagesRoute.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');

  const image = await db.query.images.findFirst({
    where: eq(images.id, id),
  });

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  if (token !== image.deleteToken && token !== config.adminToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await storage.delete(image.filename);
  await db.delete(images).where(eq(images.id, id));

  return c.json({ success: true });
});

export default imagesRoute;
