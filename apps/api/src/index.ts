import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config, storage } from './config.js';
import directUpload from './routes/direct-upload.js';
import upload from './routes/upload.js';
import imagesRoute from './routes/images.js';
import internalMediaFinalized from './routes/internal-media-finalized.js';
import serviceImageUpload from './routes/service-image-upload.js';
import mcpRoute from './mcp/routes.js';
import apiKeysRoute from './routes/api-keys.js';
import { serveRangedFile } from './lib/range-response.js';
import { db } from './db/client.js';
import { images } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { auth } from './lib/auth.js';
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from 'better-auth/plugins';
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
  origin: (origin) => origin || '*',
  allowHeaders: ['Content-Type', 'Authorization', 'Range', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  exposeHeaders: ['Mcp-Session-Id', 'WWW-Authenticate', 'Last-Event-Id', 'Mcp-Protocol-Version'],
  allowMethods: ['POST', 'GET', 'OPTIONS', 'DELETE', 'PUT'],
  credentials: true,
}));

app.get("/api/auth/can-register", async (c) => {
  return c.json({ canRegister: true });
});

app.get("/api/auth/registration-status", async (c) => {
  const [user] = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  return c.json({ isFirstUser: !user });
});

// Better Auth handler and RFC 9207 (SEP-2468) iss parameter middleware for MCP OAuth redirects
app.use('/api/auth/mcp/authorize', async (c, next) => {
  await next();
  const loc = c.res.headers.get('Location');
  if (c.res.status >= 300 && c.res.status < 400 && loc && !loc.startsWith('/')) {
    try {
      const issuer = config.publicBaseUrl.replace(/\/$/, '');
      const issuerOrigin = new URL(issuer).origin;
      const u = new URL(loc);
      if (u.origin !== issuerOrigin && !u.searchParams.has('iss')) {
        u.searchParams.set('iss', issuer);
        c.res.headers.set('Location', u.href);
      }
    } catch {
      // Ignore URL parsing errors
    }
  }
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// RFC 8414 OAuth 2.0 Authorization Server Metadata & OpenID Connect Discovery
const discoveryHandler = oAuthDiscoveryMetadata(auth);
const prmHandler = oAuthProtectedResourceMetadata(auth);

const handleDiscovery = async (c: any) => {
  const issuer = config.publicBaseUrl.replace(/\/$/, '');
  const req = new Request(new URL(c.req.path, issuer), {
    headers: c.req.raw.headers,
  });
  const upstream = await discoveryHandler(req);
  const body = (await upstream.json()) as Record<string, unknown>;
  body.authorization_response_iss_parameter_supported = true;
  return c.json(body, upstream.status as any);
};

app.get('/.well-known/oauth-authorization-server', handleDiscovery);
app.get('/.well-known/openid-configuration', handleDiscovery);

// RFC 9728 OAuth 2.0 Protected Resource Metadata
const handlePrm = async (c: any) => {
  const issuer = config.publicBaseUrl.replace(/\/$/, '');
  const req = new Request(new URL(c.req.path, issuer), {
    headers: c.req.raw.headers,
  });
  const upstream = await prmHandler(req);
  const body = (await upstream.json()) as Record<string, unknown>;
  return c.json(body, upstream.status as any);
};

app.get('/.well-known/oauth-protected-resource', handlePrm);
app.get('/.well-known/oauth-protected-resource/*', handlePrm);

// Public API routes
app.route('/api/images', imagesRoute);

// Ticket-based direct upload for MCP sandbox / container environments
app.route('/api/upload/direct', directUpload);

// Protected API routes
app.route('/api/upload', upload);

// Internal callback from uploader service (block at nginx in production)
app.route('/api/internal/media-finalized', internalMediaFinalized);

// Trusted service image upload (public, bearer auth)
app.route('/api/service/image-upload', serviceImageUpload);

// Model Context Protocol (MCP) server
app.route('/api/mcp', mcpRoute);

// User API Keys for MCP and programmatic access
app.route('/api/user/api-keys', apiKeysRoute);

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
