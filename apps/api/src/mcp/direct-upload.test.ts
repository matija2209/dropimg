import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import sharp from 'sharp';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { buildDropImgServer } from './server.js';
import { db } from '../db/client.js';
import { images, imageVariants, user as userTable } from '../db/schema.js';
import { storage } from '../config.js';
import directUpload from '../routes/direct-upload.js';
import {
  createUploadTicket,
  verifyAndConsumeUploadTicket,
  getTicketResult,
} from '../lib/upload-ticket.js';

test('Direct Upload: Ticket signature, verification, expiration, and replay prevention', async () => {
  const userId = `user_${Date.now()}`;

  // 1. Valid ticket creation and consumption
  const { ticket, ticketId, expiresAt } = createUploadTicket({
    userId,
    filename: 'test.png',
    altName: 'Direct test',
    mode: 'upload',
    expiresInSeconds: 300,
  });

  assert.ok(ticket.includes('.'), 'Ticket should contain dot separator');
  assert.ok(ticketId.startsWith('tkt_'), 'Ticket ID should start with prefix');
  assert.ok(expiresAt.getTime() > Date.now(), 'Expiration must be in future');

  // Verify and consume
  const verified = verifyAndConsumeUploadTicket(ticket);
  assert.equal(verified.valid, true);
  if (verified.valid) {
    assert.equal(verified.payload.userId, userId);
    assert.equal(verified.payload.filename, 'test.png');
    assert.equal(verified.payload.altName, 'Direct test');
  }

  // 2. Replay prevention: second consumption must fail
  const replayAttempt = verifyAndConsumeUploadTicket(ticket);
  assert.equal(replayAttempt.valid, false);
  if (!replayAttempt.valid) {
    assert.equal(replayAttempt.statusCode, 409);
    assert.match(replayAttempt.error, /already been used/i);
  }

  // 3. Tampered ticket signature
  const [payloadPart, sigPart] = ticket.split('.');
  const tamperedSig = sigPart.slice(0, -3) + 'abc';
  const tamperedTicket = `${payloadPart}.${tamperedSig}`;
  const tamperedAttempt = verifyAndConsumeUploadTicket(tamperedTicket);
  assert.equal(tamperedAttempt.valid, false);
  if (!tamperedAttempt.valid) {
    assert.equal(tamperedAttempt.statusCode, 401);
    assert.match(tamperedAttempt.error, /signature/i);
  }

  // 4. Expired ticket
  const expired = createUploadTicket({
    userId,
    expiresInSeconds: -10, // already expired
  });
  const expiredAttempt = verifyAndConsumeUploadTicket(expired.ticket);
  assert.equal(expiredAttempt.valid, false);
  if (!expiredAttempt.valid) {
    assert.equal(expiredAttempt.statusCode, 410);
    assert.match(expiredAttempt.error, /expired/i);
  }
});

test('Direct Upload: End-to-end sandbox workflow via MCP tool and direct upload endpoint', async () => {
  const testUserId = `sandbox_user_${Date.now()}`;

  // Seed user
  db.insert(userTable)
    .values({
      id: testUserId,
      name: 'Sandbox User',
      email: `${testUserId}@test.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  // 1. Connect to MCP server with authenticated user context
  const server = buildDropImgServer({
    user: { id: testUserId, role: 'user' },
  });
  const client = new Client({ name: 'claude-web-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  // 2. Claude calls request_upload_url tool
  const toolResult = await client.callTool({
    name: 'request_upload_url',
    arguments: {
      filename: 'screenshot.png',
      altName: 'Dashboard Screenshot',
      mode: 'upload',
      expiresInMinutes: 10,
    },
  });

  assert.ok(!toolResult.isError, 'request_upload_url should succeed');
  const toolData = toolResult.structuredContent as any;
  assert.ok(toolData?.uploadUrl, 'Must return uploadUrl');
  assert.ok(toolData?.ticketId, 'Must return ticketId');
  assert.ok(toolData?.curlCommand, 'Must return curlCommand');
  assert.match(toolData.curlCommand, /curl -s -X POST -F "file=@screenshot.png"/);

  // 3. Create a test image buffer in container sandbox
  const imageBuffer = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 10, g: 120, b: 240, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  // 4. Simulate sandbox container POSTing multipart file to directUpload route
  const app = new Hono();
  app.route('/api/upload/direct', directUpload);

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }),
    'screenshot.png'
  );

  const uploadReq = new Request(toolData.uploadUrl, {
    method: 'POST',
    body: formData,
  });

  const uploadRes = await app.fetch(uploadReq);
  assert.equal(uploadRes.status, 201, 'Direct upload must return 201 Created');
  const uploadJson = (await uploadRes.json()) as any;

  assert.ok(uploadJson.id, 'Must return image ID');
  assert.equal(uploadJson.userId, testUserId, 'Must be attributed to the authenticated user');
  assert.ok(uploadJson.rawUrl, 'Must return rawUrl');
  assert.ok(uploadJson.pageUrl, 'Must return pageUrl');
  assert.ok(uploadJson.markdown, 'Must return markdown snippet');
  assert.match(uploadJson.markdown, /!\[Dashboard Screenshot\]/);
  assert.equal(uploadJson.width, 64);
  assert.equal(uploadJson.height, 64);

  // 5. Verify database records
  const dbImage = await db.query.images.findFirst({
    where: eq(images.id, uploadJson.id),
    with: { variants: true },
  });
  assert.ok(dbImage, 'Image should exist in SQLite database');
  assert.equal(dbImage.userId, testUserId, 'Database record must have correct userId');
  assert.equal(dbImage.source, 'mcp-direct');
  assert.ok((dbImage.variants ?? []).length > 0, 'Image should have generated responsive variants');

  // 6. Test claim_upload_ticket MCP tool
  const claimResult = await client.callTool({
    name: 'claim_upload_ticket',
    arguments: {
      ticketId: toolData.ticketId,
    },
  });

  assert.ok(!claimResult.isError, 'claim_upload_ticket should succeed');
  const claimData = claimResult.structuredContent as any;
  assert.equal(claimData.id, uploadJson.id, 'Claimed image ID must match uploaded image');
  assert.equal(claimData.rawUrl, uploadJson.rawUrl);

  // 7. Verify replay protection over HTTP: attempting to reuse ticket fails
  const replayReq = new Request(toolData.uploadUrl, {
    method: 'POST',
    body: formData,
  });
  const replayRes = await app.fetch(replayReq);
  assert.equal(replayRes.status, 409, 'Reusing ticket must return 409 Conflict');

  // 8. Clean up test assets
  await Promise.allSettled([
    storage.delete(dbImage.filename),
    ...(dbImage.variants ?? []).map((v) => storage.delete(v.storageKey)),
  ]);
  db.delete(imageVariants).where(eq(imageVariants.imageId, uploadJson.id)).run();
  db.delete(images).where(eq(images.id, uploadJson.id)).run();
  db.delete(userTable).where(eq(userTable.id, testUserId)).run();
});
