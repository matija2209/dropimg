import { Hono, type Context } from 'hono';
import { config } from '../config.js';
import { serveRangedFile } from '../lib/range-response.js';
import {
  PDF_MIME,
  contentDispositionInline,
  findDocument,
  verifyDocumentSignature,
} from '../services/documents.js';
import type { Document } from '../db/schema.js';

// Documents are served from the storage/CDN host (config.documentBaseUrl), never from the app's own domain:
// a PDF can carry scripts, and on the app origin those would run next to the user's session.
const documentsRoute = new Hono();

/**
 * The CDN pulls from the app origin with the origin's Host header, so the CDN announces the host it is
 * serving in `CDN-Host`. A browser navigating straight to the app domain cannot add that header.
 */
export function isDocumentHostRequest(headers: { get(name: string): string | null | undefined }): boolean {
  const documentHost = new URL(config.documentBaseUrl).host.toLowerCase();
  const appHost = new URL(config.appUrl).host.toLowerCase();
  if (documentHost === appHost) return true; // no separate document host configured (local development)

  const requestHost = (headers.get('cdn-host') || headers.get('host') || '').toLowerCase();
  return requestHost === documentHost;
}

documentsRoute.use('/d/*', async (c, next) => {
  if (!isDocumentHostRequest(c.req.raw.headers)) {
    return c.json({ error: 'Document not found' }, 404, { 'Cache-Control': 'no-store' });
  }
  await next();
});

function documentHeaders(doc: Document, cacheControl: string): Record<string, string> {
  return {
    'Content-Type': PDF_MIME,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': contentDispositionInline(doc.originalFilename),
    'Cache-Control': cacheControl,
    'Referrer-Policy': 'no-referrer',
    ...(doc.visibility === 'private' ? { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } : {}),
  };
}

function serveDocument(c: Context, doc: Document, cacheControl: string) {
  return serveRangedFile(c, {
    storageKey: doc.storageKey,
    mimeType: PDF_MIME,
    fileSize: doc.size,
    headers: documentHeaders(doc, cacheControl),
  });
}

const forbidden = (c: Context, message: string) =>
  c.json({ error: message }, 403, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });

// Signed, expiring link: /d/:id/:exp/:signature/:filename
documentsRoute.get('/d/:id/:exp/:sig/:name?', async (c) => {
  const { id, exp, sig } = c.req.param();

  const check = verifyDocumentSignature(id, exp, sig);
  if (check === 'invalid') return forbidden(c, 'Invalid document link.');
  if (check === 'expired') return forbidden(c, 'This document link has expired. Request a fresh link with get_document.');

  const doc = await findDocument(id);
  if (!doc) return c.json({ error: 'Document not found' }, 404, { 'Cache-Control': 'no-store' });

  try {
    // Signed links are capabilities: never let a shared cache keep a copy past expiry or deletion.
    return await serveDocument(c, doc, 'private, no-store');
  } catch {
    return c.json({ error: 'Document not found' }, 404, { 'Cache-Control': 'no-store' });
  }
});

// Permanent link, only for documents explicitly uploaded with visibility "public": /d/:id/:filename
documentsRoute.get('/d/:id/:name?', async (c) => {
  const doc = await findDocument(c.req.param('id'));
  if (!doc || doc.visibility !== 'public') {
    return c.json({ error: 'Document not found' }, 404, { 'Cache-Control': 'no-store' });
  }

  try {
    return await serveDocument(c, doc, 'public, max-age=300');
  } catch {
    return c.json({ error: 'Document not found' }, 404, { 'Cache-Control': 'no-store' });
  }
});

export default documentsRoute;
