import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { processVideo } from './video-processing.js';
import { storage, config } from '../config.js';
import { db } from '../db/client.js';
import { images, imageVariants, user as userTable } from '../db/schema.js';
import { buildDropImgServer, readBodyToBuffer } from '../mcp/server.js';
import directUpload from '../routes/direct-upload.js';
import upload from '../routes/upload.js';
import { createUploadTicket } from '../lib/upload-ticket.js';

const execFileAsync = promisify(execFile);

async function generateSampleMp4(): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'test-video-'));
  const outputPath = join(tmpDir, 'sample.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=320x240:d=1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-y', outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('processVideo: generates poster frame, probes metadata, and stores original video', async () => {
  const videoBuffer = await generateSampleMp4();
  const id = `test_vid_${Date.now()}`;

  const processed = await processVideo({
    id,
    fileName: 'sample.mp4',
    mimeType: 'video/mp4',
    buffer: videoBuffer,
    transcode: false,
    storage,
  });

  assert.equal(processed.original.mimeType, 'video/mp4');
  assert.equal(processed.original.width, 320);
  assert.equal(processed.original.height, 240);
  assert.ok(processed.durationMs && processed.durationMs >= 900, 'Duration should be ~1000ms');

  // Verify poster variant was generated
  const posterVariant = processed.variants.find((v) => v.variant === 'poster');
  assert.ok(posterVariant, 'Poster variant must exist');
  assert.equal(posterVariant.mimeType, 'image/webp');
  assert.ok(posterVariant.size > 0);
  assert.equal(posterVariant.width, 320);
  assert.equal(posterVariant.height, 240);

  // Verify stored in storage driver and consume stream
  const originalFile = await storage.get(processed.original.storageKey);
  const origBuf = await readBodyToBuffer(originalFile.body);
  assert.ok(origBuf.length > 0, 'Original file should exist in storage');

  const posterFile = await storage.get(posterVariant.storageKey);
  const posterBuf = await readBodyToBuffer(posterFile.body);
  assert.ok(posterBuf.length > 0, 'Poster file should exist in storage');

  // Cleanup storage
  await storage.delete(processed.original.storageKey);
  await storage.delete(posterVariant.storageKey);
});

test('Direct Upload (/api/upload/direct): handles video upload with signed ticket and poster extraction', async () => {
  const videoBuffer = await generateSampleMp4();
  const userId = `user_dir_vid_${Date.now()}`;

  db.insert(userTable).values({
    id: userId,
    name: 'Direct Video User',
    email: `${userId}@example.com`,
    emailVerified: true,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  // 1. Generate signed upload ticket for a video
  const { ticket } = createUploadTicket({
    userId,
    filename: 'clip.mp4',
    altName: 'Direct Video Upload',
    mediaType: 'video',
    expiresInSeconds: 300,
  });

  // 2. Perform direct upload to /api/upload/direct
  const boundary = '----WebKitFormBoundaryVideoTest';
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const multipartBody = Buffer.concat([
    Buffer.from(header, 'utf8'),
    videoBuffer,
    Buffer.from(footer, 'utf8'),
  ]);

  const req = new Request(`http://localhost/api/upload/direct?ticket=${ticket}`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  const app = new Hono();
  app.route('/api/upload/direct', directUpload);
  const res = await app.fetch(req);
  assert.equal(res.status, 201);
  const data = (await res.json()) as any;

  assert.equal(data.mediaType, 'video');
  assert.equal(data.width, 320);
  assert.equal(data.height, 240);
  assert.ok(data.videoHtml && data.videoHtml.includes('<video src='), 'Should return HTML5 video tag');
  assert.ok(data.posterUrl, 'Should return poster URL');
  assert.ok(data.variants.poster, 'Should have poster variant');

  // Verify in database
  const dbRecord = await db.query.images.findFirst({
    where: eq(images.id, data.id),
    with: { variants: true },
  });
  assert.ok(dbRecord, 'Video record should be saved in database');
  assert.equal(dbRecord.mediaType, 'video');

  // Clean up
  await storage.delete(dbRecord.filename);
  for (const v of dbRecord.variants) {
    await storage.delete(v.storageKey);
  }
  db.transaction((tx) => {
    tx.delete(imageVariants).where(eq(imageVariants.imageId, data.id)).run();
    tx.delete(images).where(eq(images.id, data.id)).run();
    tx.delete(userTable).where(eq(userTable.id, userId)).run();
  });
});

test('MCP Server: upload_video, claim_upload_ticket, and get_image poster inspection', async () => {
  const videoBuffer = await generateSampleMp4();
  const userId = `user_mcp_vid_${Date.now()}`;

  db.insert(userTable).values({
    id: userId,
    name: 'Video Test User',
    email: `${userId}@example.com`,
    emailVerified: true,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  const mcpServer = buildDropImgServer({ user: { id: userId }, isAdmin: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  // 1. Test upload_video tool
  const uploadResult = await client.callTool({
    name: 'upload_video',
    arguments: {
      videoData: `data:video/mp4;base64,${videoBuffer.toString('base64')}`,
      filename: 'mcp-test.mp4',
      altName: 'MCP Video Upload',
    },
  });

  assert.ok(!uploadResult.isError, 'upload_video should succeed');
  const uploadContent = uploadResult.content as Array<{ type: string; text?: string }>;
  assert.match(uploadContent[0].text!, /Video successfully uploaded/i);

  const structured = (uploadResult as any).structuredContent;
  assert.ok(structured && structured.id);
  assert.equal(structured.mediaType, 'video');
  assert.equal(structured.width, 320);
  assert.equal(structured.height, 240);
  assert.ok(structured.videoHtml);

  const videoId = structured.id;

  // 2. Test get_image with variant: 'poster' and includeImageData: true
  const posterResult = await client.callTool({
    name: 'get_image',
    arguments: {
      id: videoId,
      variant: 'poster',
      includeImageData: true,
    },
  });

  assert.ok(!posterResult.isError, 'get_image poster should succeed');
  const posterContent = posterResult.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  assert.ok(posterContent.some((b) => b.type === 'image' && b.mimeType === 'image/webp' && b.data), 'Should return base64 image data for video poster frame');

  // 3. Test request_upload_url with video auto-detection
  const ticketResult = await client.callTool({
    name: 'request_upload_url',
    arguments: {
      filename: 'sandbox_recording.mp4',
      altName: 'Sandbox Recording',
    },
  });

  const ticketPayload = (ticketResult as any).structuredContent;
  assert.equal(ticketPayload.mediaType, 'video');
  assert.match(ticketPayload.curlCommand, /sandbox_recording\.mp4/);

  // Clean up
  const dbRecord = await db.query.images.findFirst({
    where: eq(images.id, videoId),
    with: { variants: true },
  });
  if (dbRecord) {
    await storage.delete(dbRecord.filename);
    for (const v of dbRecord.variants) {
      await storage.delete(v.storageKey);
    }
    db.transaction((tx) => {
      tx.delete(imageVariants).where(eq(imageVariants.imageId, videoId)).run();
      tx.delete(images).where(eq(images.id, videoId)).run();
      tx.delete(userTable).where(eq(userTable.id, userId)).run();
    });
  }

  await client.close();
  await mcpServer.close();
});

test('API route POST /api/upload: directly accepts video and returns serialized video asset', async () => {
  const videoBuffer = await generateSampleMp4();
  const originalPublicMode = config.publicMode;
  config.publicMode = true;

  try {
    const app = new Hono();
    app.route('/api/upload', upload);

    const boundary = '----WebKitFormBoundaryUploadTest';
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="direct_video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const multipartBody = Buffer.concat([
      Buffer.from(header, 'utf8'),
      videoBuffer,
      Buffer.from(footer, 'utf8'),
    ]);

    const req = new Request('http://localhost/api/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    const res = await app.fetch(req);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;

    assert.equal(data.mediaType, 'video');
    assert.equal(data.width, 320);
    assert.equal(data.height, 240);
    assert.ok(data.videoHtml && data.videoHtml.includes('<video src='));
    assert.ok(data.variants.poster);

    // Clean up
    const dbRecord = await db.query.images.findFirst({
      where: eq(images.id, data.id),
      with: { variants: true },
    });
    if (dbRecord) {
      await storage.delete(dbRecord.filename);
      for (const v of dbRecord.variants) {
        await storage.delete(v.storageKey);
      }
      db.transaction((tx) => {
        tx.delete(imageVariants).where(eq(imageVariants.imageId, data.id)).run();
        tx.delete(images).where(eq(images.id, data.id)).run();
      });
    }
  } finally {
    config.publicMode = originalPublicMode;
  }
});

test('API route POST /api/upload: authenticates via Bearer personal API key and associates userId', async () => {
  const videoBuffer = await generateSampleMp4();
  const originalPublicMode = config.publicMode;
  config.publicMode = false; // Auth strictly required

  const testUserId = `test-user-${Date.now()}`;
  const { generateApiKey } = await import('../lib/mcp-auth.js');
  const { apiKeys, user: userTable } = await import('../db/schema.js');
  const { key, keyHash, keyPrefix } = generateApiKey();

  // Create test user and API key
  db.insert(userTable).values({
    id: testUserId,
    name: 'Bearer Test User',
    email: `${testUserId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  db.insert(apiKeys).values({
    id: `key-${Date.now()}`,
    userId: testUserId,
    name: 'Test Key',
    keyHash,
    keyPrefix,
    createdAt: new Date(),
  }).run();

  try {
    const app = new Hono();
    app.route('/api/upload', upload);

    const boundary = '----WebKitFormBoundaryBearerTest';
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bearer_video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const multipartBody = Buffer.concat([
      Buffer.from(header, 'utf8'),
      videoBuffer,
      Buffer.from(footer, 'utf8'),
    ]);

    const req = new Request('http://localhost/api/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${key}`,
      },
      body: multipartBody,
    });

    const res = await app.fetch(req);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.mediaType, 'video');

    const dbRecord = await db.query.images.findFirst({
      where: eq(images.id, data.id),
      with: { variants: true },
    });
    assert.ok(dbRecord);
    assert.equal(dbRecord.userId, testUserId);

    // Clean up
    await storage.delete(dbRecord.filename);
    for (const v of dbRecord.variants) {
      await storage.delete(v.storageKey);
    }
    db.transaction((tx) => {
      tx.delete(imageVariants).where(eq(imageVariants.imageId, data.id)).run();
      tx.delete(images).where(eq(images.id, data.id)).run();
      tx.delete(apiKeys).where(eq(apiKeys.userId, testUserId)).run();
      tx.delete(userTable).where(eq(userTable.id, testUserId)).run();
    });
  } finally {
    config.publicMode = originalPublicMode;
  }
});

