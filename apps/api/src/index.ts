import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config, storage } from './config.js';
import upload from './routes/upload.js';
import imagesRoute from './routes/images.js';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

// API routes first
app.route('/api/upload', upload);
app.route('/api/images', imagesRoute);

// Serve raw storage objects
app.get('/raw/*', async (c) => {
  const filename = decodeURIComponent(c.req.path.replace(/^\/raw\//, ''));

  try {
    const { body, mimeType } = await storage.get(filename);

    return c.body(body, 200, {
      'Content-Type': mimeType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  } catch (err) {
    return c.notFound();
  }
});

// Static files
app.use('/*', serveStatic({ root: './public' }));

// SPA Fallback: Serve index.html for any non-API GET requests that reach this point
app.notFound(async (c) => {
  if (c.req.method === 'GET' && !c.req.path.startsWith('/api/') && !c.req.path.startsWith('/raw/')) {
    try {
      const html = await readFile('./public/index.html', 'utf-8');
      return c.html(html);
    } catch (err) {
      // If index.html is missing, fall through to default 404
    }
  }
  return c.text('404 Not Found', 404);
});

console.log(`Server is running on port ${config.port}`);

serve({
  fetch: app.fetch,
  port: config.port,
});
