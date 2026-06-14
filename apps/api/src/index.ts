import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config, storage } from './config.js';
import upload from './routes/upload.js';
import imagesRoute from './routes/images.js';
import internalMediaFinalized from './routes/internal-media-finalized.js';
import serviceImageUpload from './routes/service-image-upload.js';
import { serveRangedFile } from './lib/range-response.js';
import { db } from './db/client.js';
import { images } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { auth } from './lib/auth.js';
import { authMiddleware, adminMiddleware } from './lib/middleware.js';
import * as schema from './db/schema.js';

const app = new Hono<{
  Variables: {
    user?: typeof auth.$Infer.Session.user;
    session?: typeof auth.$Infer.Session.session;
  };
}>();

app.use('*', logger());
app.use('*', cors({
  origin: [config.appUrl, 'http://localhost:5173'], // Allow local dev and production
  allowHeaders: ['Content-Type', 'Authorization', 'Range'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  credentials: true,
}));

app.get("/api/auth/can-register", async (c) => {
  return c.json({ canRegister: true });
});

app.get("/api/auth/registration-status", async (c) => {
  const [user] = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  return c.json({ isFirstUser: !user });
});

// Better Auth handler
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Public API routes
app.route('/api/images', imagesRoute);

// Protected API routes
app.route('/api/upload', upload);

// Internal callback from uploader service (block at nginx in production)
app.route('/api/internal/media-finalized', internalMediaFinalized);

// Trusted service image upload (public, bearer auth)
app.route('/api/service/image-upload', serviceImageUpload);

app.get('/api/me', authMiddleware, (c) => {
  const user = c.get('user');
  return c.json(user);
});

app.get('/api/admin/status', authMiddleware, adminMiddleware, (c) => {
  return c.json({ 
    status: 'ok', 
    message: 'Welcome to the admin area',
    user: c.get('user')
  });
});

// Serve raw storage objects
app.get('/raw/*', async (c) => {
  const filename = decodeURIComponent(c.req.path.replace(/^\/raw\//, ''));

  try {
    const image = await db.query.images.findFirst({
      where: eq(images.filename, filename),
    });

    const mimeType =
      image?.mimeType ||
      (filename.endsWith('.mp4') ? 'video/mp4' : undefined) ||
      'application/octet-stream';

    if (image?.mediaType === 'video' || mimeType.startsWith('video/')) {
      return serveRangedFile(c, {
        storageKey: filename,
        mimeType,
        fileSize: image?.size,
      });
    }

    const { body, mimeType: storedMime } = await storage.get(filename);

    return c.body(body, 200, {
      'Content-Type': storedMime || mimeType,
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
