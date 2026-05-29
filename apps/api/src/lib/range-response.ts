import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'hono';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { config } from '../config.js';
import { makeS3Client } from './staged-upload.js';

export type RangeRequest = {
  start: number;
  end: number;
};

export function parseRangeHeader(rangeHeader: string | undefined, totalSize: number): RangeRequest | null {
  if (!rangeHeader?.startsWith('bytes=')) {
    return null;
  }

  const [startRaw, endRaw] = rangeHeader.replace('bytes=', '').split('-');
  const start = startRaw ? Number.parseInt(startRaw, 10) : 0;
  const end = endRaw ? Number.parseInt(endRaw, 10) : totalSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || end >= totalSize) {
    return null;
  }

  return { start, end };
}

export async function serveRangedFile(
  c: Context,
  input: {
    storageKey: string;
    mimeType: string;
    fileSize?: number;
  }
): Promise<Response> {
  const rangeHeader = c.req.header('range');
  const totalSize = input.fileSize ?? (await getObjectSize(input.storageKey));

  if (!rangeHeader || totalSize === null) {
    const full = await getObjectStream(input.storageKey);
    return new Response(full.body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': input.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(totalSize !== null ? { 'Content-Length': String(totalSize) } : {}),
      },
    });
  }

  const range = parseRangeHeader(rangeHeader, totalSize);
  if (!range) {
    return c.body(null, 416, {
      'Content-Range': `bytes */${totalSize}`,
    });
  }

  const chunkSize = range.end - range.start + 1;
  const stream = await getObjectStream(input.storageKey, range);

  return new Response(stream.body as BodyInit, {
    status: 206,
    headers: {
      'Content-Type': input.mimeType,
      'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
      'Content-Length': String(chunkSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

async function getObjectSize(storageKey: string): Promise<number | null> {
  if (config.storageDriver === 'local') {
    try {
      const filePath = join(config.uploadDir, storageKey);
      const info = await stat(filePath);
      return info.size;
    } catch {
      return null;
    }
  }

  const client = makeS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: storageKey,
    })
  );
  return response.ContentLength ?? null;
}

async function getObjectStream(
  storageKey: string,
  range?: RangeRequest
): Promise<{ body: Readable | Buffer }> {
  if (config.storageDriver === 'local') {
    const filePath = join(config.uploadDir, storageKey);
    const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
    return { body: stream };
  }

  const client = makeS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: storageKey,
      ...(range
        ? { Range: `bytes=${range.start}-${range.end}` }
        : {}),
    })
  );

  if (!response.Body) {
    throw new Error('Empty object body');
  }

  return { body: response.Body as Readable };
}
