import { Hono } from 'hono';
import sharp from 'sharp';
import { db } from '../db/client.js';
import { imageVariants, images } from '../db/schema.js';
import { storage, config } from '../config.js';
import { serializeImageAsset } from '../lib/image-assets.js';
import {
  ImageProcessingError,
  processAndStoreImage,
  uploadModes,
  type UploadMode,
} from '../services/image-processing.js';
import {
  verifyAndConsumeUploadTicket,
  storeTicketResult,
  getTicketResult,
} from '../lib/upload-ticket.js';

const directUpload = new Hono();

function parseUploadMode(rawMode: unknown, fallback?: UploadMode): UploadMode {
  if (typeof rawMode !== 'string' || rawMode.length === 0) {
    return fallback || 'upload';
  }
  if ((uploadModes as readonly string[]).includes(rawMode)) {
    return rawMode as UploadMode;
  }
  return fallback || 'upload';
}

function parseQuality(rawQuality: unknown, fallback?: number): number | undefined {
  if (typeof rawQuality === 'number' && !Number.isNaN(rawQuality)) {
    return Math.max(1, Math.min(100, rawQuality));
  }
  if (typeof rawQuality !== 'string' || rawQuality.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(rawQuality, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, parsed));
}

// Check status or claim result of a ticket
directUpload.get('/status', (c) => {
  const ticketId = c.req.query('ticketId');
  if (!ticketId) {
    return c.json({ error: 'ticketId parameter is required' }, 400);
  }
  const result = getTicketResult(ticketId);
  if (!result) {
    return c.json({ error: 'No result found or ticket has expired/not uploaded yet' }, 404);
  }
  return c.json(result);
});

directUpload.get('/', (c) => {
  return c.json({
    status: 'ok',
    endpoint: '/api/upload/direct',
    usage: 'POST with ?ticket=<signed_ticket> and multipart/form-data field "file"',
  });
});

directUpload.on(['POST', 'PUT'], '/', async (c) => {
  // 1. Extract Ticket
  const queryTicket = c.req.query('ticket');
  const headerTicket = c.req.header('X-Upload-Ticket');
  const authHeader = c.req.header('Authorization') || '';
  const bearerTicket = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const ticketString = queryTicket || headerTicket || (bearerTicket.includes('.') ? bearerTicket : '');

  if (!ticketString) {
    return c.json(
      { error: 'Missing upload ticket. Pass ?ticket=... or X-Upload-Ticket header.' },
      400
    );
  }

  // 2. Validate and consume ticket
  const verification = verifyAndConsumeUploadTicket(ticketString);
  if (!verification.valid) {
    return c.json({ error: verification.error }, verification.statusCode as any);
  }

  const { payload } = verification;

  // 3. Extract File from Multipart Form or Raw Binary Body
  const contentType = c.req.header('content-type') || '';
  let buffer: Buffer;
  let fileName = payload.filename || 'image.png';
  let mimeType = 'image/png';
  let altName = payload.altName || '';
  let mode: UploadMode = payload.mode || 'upload';
  let quality: number | undefined = payload.quality;

  if (contentType.includes('multipart/form-data')) {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch (err: any) {
      return c.json({ error: `Failed to parse multipart body: ${err?.message || err}` }, 400);
    }

    const file = body['file'] as File;
    if (!file) {
      return c.json({ error: 'No file uploaded in form field "file"' }, 400);
    }

    if (typeof body['altName'] === 'string' && body['altName'].trim()) {
      altName = body['altName'].trim();
    }
    mode = parseUploadMode(body['mode'], payload.mode);
    quality = parseQuality(body['quality'], payload.quality);

    fileName = file.name || fileName;
    mimeType = file.type || mimeType;

    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    // Raw binary upload (e.g. curl --data-binary @image.png or Content-Type: image/png)
    const arrayBuffer = await c.req.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);

    if (c.req.header('x-filename')) {
      fileName = decodeURIComponent(c.req.header('x-filename')!);
    }
    if (contentType.startsWith('image/')) {
      mimeType = contentType.split(';')[0].trim();
    }
  }

  if (buffer.length === 0) {
    return c.json({ error: 'Uploaded file is empty.' }, 400);
  }

  if (buffer.length > config.maxUploadMb * 1024 * 1024) {
    return c.json({ error: `File size exceeds ${config.maxUploadMb}MB limit` }, 400);
  }

  // Sniff format if mimeType is generic or missing
  if (
    !mimeType ||
    mimeType === 'application/octet-stream' ||
    mimeType === 'application/x-www-form-urlencoded'
  ) {
    try {
      const meta = await sharp(buffer).metadata();
      if (meta.format) {
        mimeType = `image/${meta.format === 'jpg' ? 'jpeg' : meta.format}`;
      }
    } catch {
      // Keep fallback
    }
  }

  if (!config.allowedTypes.includes(mimeType)) {
    return c.json({ error: `File type ${mimeType} not allowed` }, 400);
  }

  const id = Math.random().toString(36).substring(2, 10);
  const deleteToken = Math.random().toString(36).substring(2, 15);
  let processed;

  try {
    processed = await processAndStoreImage({
      id,
      fileName,
      mimeType,
      buffer,
      mode,
      quality,
      backgroundRemoval: {
        apiKey: config.photoroom.apiKey,
        apiUrl: config.photoroom.apiUrl,
        outputFormat: config.photoroom.outputFormat,
      },
      storage,
    });
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      return c.json({ error: error.message }, error.statusCode as 400 | 500 | 502);
    }
    console.error('[direct-upload] Processing error:', error);
    return c.json({ error: 'Image processing failed' }, 500);
  }

  try {
    db.transaction((tx) => {
      tx.insert(images).values({
        id,
        filename: processed.original.storageKey,
        altName: altName || null,
        mimeType: processed.original.mimeType,
        mediaType: 'image',
        size: processed.original.size,
        width: processed.original.width,
        height: processed.original.height,
        isAnimated: processed.isAnimated,
        deleteToken,
        userId: payload.userId || null,
        source: 'mcp-direct',
        createdAt: new Date(),
      }).run();

      if (processed.variants.length > 0) {
        tx.insert(imageVariants).values(
          processed.variants.map((v) => ({
            imageId: id,
            variant: v.variant,
            storageKey: v.storageKey,
            mimeType: v.mimeType,
            size: v.size,
            width: v.width,
            height: v.height,
          }))
        ).run();
      }
    });
  } catch (error) {
    await Promise.allSettled([
      storage.delete(processed.original.storageKey),
      ...processed.variants.map((v) => storage.delete(v.storageKey)),
    ]);
    console.error('[direct-upload] Database error:', error);
    return c.json({ error: 'Failed to save image record to database' }, 500);
  }

  const serialized = serializeImageAsset({
    id,
    filename: processed.original.storageKey,
    altName: altName || null,
    mimeType: processed.original.mimeType,
    mediaType: 'image',
    durationMs: null,
    transcoded: false,
    originalSize: null,
    size: processed.original.size,
    width: processed.original.width,
    height: processed.original.height,
    isAnimated: processed.isAnimated,
    deleteToken,
    userId: payload.userId || null,
    source: 'mcp-direct',
    createdAt: new Date(),
    variants: processed.variants.map((v) => ({
      imageId: id,
      variant: v.variant,
      storageKey: v.storageKey,
      mimeType: v.mimeType,
      size: v.size,
      width: v.width,
      height: v.height,
    })),
  });

  const pageUrl = `${config.appUrl}/i/${id}`;
  const rawUrl = `${config.publicBaseUrl}/raw/${processed.original.storageKey}`;
  const markdown = `![${altName || id}](${rawUrl})`;

  const resultPayload = {
    id,
    pageUrl,
    rawUrl,
    directUrl: serialized.directUrl,
    markdown,
    responsiveHtml: serialized.responsiveHtml,
    mimeType: processed.original.mimeType,
    width: processed.original.width,
    height: processed.original.height,
    size: processed.original.size,
    deleteToken,
    deleteUrl: `${config.appUrl}/api/images/${id}?token=${deleteToken}`,
    variants: serialized.variants,
    processing: processed.processing,
    userId: payload.userId || null,
    ticketId: payload.ticketId,
  };

  // Cache result for claim_upload_ticket tool
  storeTicketResult(payload.ticketId, resultPayload);

  return c.json(resultPayload, 201);
});

export default directUpload;
