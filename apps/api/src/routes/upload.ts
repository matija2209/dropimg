import { Hono } from 'hono';
import { db } from '../db/client.js';
import { images } from '../db/schema.js';
import { storage, config } from '../config.js';

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
  const extension = file.name.split('.').pop();
  const filename = `${id}.${extension}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const storedFile = await storage.put({
    key: filename,
    body: buffer,
    mimeType: file.type,
  });

  await db.insert(images).values({
    id,
    filename,
    altName: altName || null,
    mimeType: file.type,
    size: file.size,
    deleteToken,
    createdAt: new Date(),
  });

  return c.json({
    id,
    directUrl: storedFile.url,
    pageUrl: `${config.appUrl}/i/${id}`,
    deleteUrl: `${config.appUrl}/api/images/${id}?token=${deleteToken}`,
  });
});

export default upload;
