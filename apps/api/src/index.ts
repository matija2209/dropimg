import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config, storage } from './config.js';
import upload from './routes/upload.js';
import imagesRoute from './routes/images.js';
import { serveStatic } from '@hono/node-server/serve-static';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

// Serve static files from web/dist in production
app.use('/*', serveStatic({ root: './public' }));

app.route('/api/upload', upload);
app.route('/api/images', imagesRoute);

// Serve raw storage objects for backward compatibility.
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

app.get('/', (c) => {
  return c.text('DropImg API is running');
});

console.log(`Server is running on port ${config.port}`);

serve({
  fetch: app.fetch,
  port: config.port,
});
