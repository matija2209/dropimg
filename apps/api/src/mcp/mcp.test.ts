import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';

import { buildDropImgServer } from './server.js';
import { db } from '../db/client.js';
import { images, imageVariants, user as userTable, apiKeys } from '../db/schema.js';
import { config, storage } from '../config.js';
import mcpRoute from './routes.js';
import apiKeysRoute from '../routes/api-keys.js';
import { generateApiKey, hashApiKey, resolveMcpIdentity } from '../lib/mcp-auth.js';
import { Hono } from 'hono';

test('MCP Server: tools, resources, and end-to-end image lifecycle', async () => {
  const server = buildDropImgServer();
  const client = new Client({ name: 'mcp-test-client', version: '1.0.0' });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  // 1. List tools
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((t) => t.name);
  assert.ok(toolNames.includes('upload_image'), 'Should register upload_image tool');
  assert.ok(toolNames.includes('get_image'), 'Should register get_image tool');
  assert.ok(toolNames.includes('list_images'), 'Should register list_images tool');
  assert.ok(toolNames.includes('delete_image'), 'Should register delete_image tool');
  assert.ok(toolNames.includes('request_upload_url'), 'Should register request_upload_url tool');
  assert.ok(toolNames.includes('claim_upload_ticket'), 'Should register claim_upload_ticket tool');

  // 2. Generate a small test image (30x30 red square)
  const testPngBuffer = await sharp({
    create: {
      width: 30,
      height: 30,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const base64Data = testPngBuffer.toString('base64');

  // 3. Call upload_image tool
  const uploadResult = await client.callTool({
    name: 'upload_image',
    arguments: {
      imageData: `data:image/png;base64,${base64Data}`,
      altName: 'Test MCP Image',
      mode: 'upload',
    },
  });

  assert.ok(!uploadResult.isError, 'Upload should not error');
  const structured = uploadResult.structuredContent as any;
  assert.ok(structured?.id, 'Should return an image ID');
  assert.equal(structured.width, 30);
  assert.equal(structured.height, 30);
  assert.equal(structured.mimeType, 'image/png');
  assert.ok(structured.deleteToken, 'Should return delete token');
  assert.ok(structured.rawUrl, 'Should return direct raw URL');

  const uploadedId = structured.id;
  const deleteToken = structured.deleteToken;

  // 4. Call get_image without image data
  const getResult = await client.callTool({
    name: 'get_image',
    arguments: {
      id: uploadedId,
      includeImageData: false,
    },
  });

  assert.ok(!getResult.isError);
  assert.ok(Array.isArray(getResult.content));
  assert.equal(getResult.content.length, 1);
  assert.equal(getResult.content[0].type, 'text');

  // 5. Call get_image with includeImageData: true
  const getImageDataResult = await client.callTool({
    name: 'get_image',
    arguments: {
      id: uploadedId,
      includeImageData: true,
    },
  });

  assert.ok(!getImageDataResult.isError);
  const imageBlock = getImageDataResult.content.find((c: any) => c.type === 'image') as any;
  assert.ok(imageBlock, 'Should include image content block');
  assert.ok(imageBlock.data && imageBlock.data.length > 0, 'Image data should be populated');
  assert.equal(imageBlock.mimeType, 'image/png');

  // 6. Read resource: dropimg://images/{id}
  const resourceResult = await client.readResource({
    uri: `dropimg://images/${uploadedId}`,
  });
  assert.ok(resourceResult.contents && resourceResult.contents.length > 0);
  const resourceText = (resourceResult.contents[0] as any).text;
  const parsedResource = JSON.parse(resourceText);
  assert.equal(parsedResource.id, uploadedId);

  // 7. Call list_images tool
  const listResult = await client.callTool({
    name: 'list_images',
    arguments: { limit: 10, offset: 0 },
  });
  assert.ok(!listResult.isError);
  const listStructured = listResult.structuredContent as any;
  assert.ok(listStructured.images.some((img: any) => img.id === uploadedId));

  // 8. Call delete_image with invalid token
  const failedDelete = await client.callTool({
    name: 'delete_image',
    arguments: { id: uploadedId, deleteToken: 'invalid-token' },
  });
  assert.equal(failedDelete.isError, true, 'Delete with invalid token should fail');

  // 9. Call delete_image with correct token
  const successDelete = await client.callTool({
    name: 'delete_image',
    arguments: { id: uploadedId, deleteToken },
  });
  assert.ok(!successDelete.isError, 'Delete with valid token should succeed');

  // Verify it is gone
  const verifyGet = await client.callTool({
    name: 'get_image',
    arguments: { id: uploadedId },
  });
  assert.equal(verifyGet.isError, true, 'Image should no longer be found');

  await client.close();
  await server.close();
});

test('MCP Server: Private User Accounts & Gallery Isolation', async () => {
  const aliceId = `alice_${Date.now()}`;
  const bobId = `bob_${Date.now()}`;

  // Seed two test users
  db.insert(userTable)
    .values([
      {
        id: aliceId,
        name: 'Alice',
        email: `${aliceId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'user',
      },
      {
        id: bobId,
        name: 'Bob',
        email: `${bobId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'user',
      },
    ])
    .run();

  // 1. Connect Alice's scoped MCP server
  const aliceServer = buildDropImgServer({ user: { id: aliceId, role: 'user' } });
  const aliceClient = new Client({ name: 'alice-client', version: '1.0.0' });
  const [aClientTransport, aServerTransport] = InMemoryTransport.createLinkedPair();
  await aliceServer.connect(aServerTransport);
  await aliceClient.connect(aClientTransport);

  // Generate test image
  const imgBuf = await sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();

  // Alice uploads an image
  const aliceUpload = await aliceClient.callTool({
    name: 'upload_image',
    arguments: {
      imageData: imgBuf.toString('base64'),
      altName: 'Alice Secret Asset',
    },
  });
  assert.ok(!aliceUpload.isError);
  const aliceImgId = (aliceUpload.structuredContent as any).id;

  // Verify DB record has Alice's userId
  const dbRecord = await db.query.images.findFirst({ where: eq(images.id, aliceImgId) });
  assert.equal(dbRecord?.userId, aliceId, 'Uploaded image must be tied to Alice userId');

  // Alice lists images -> should see her image
  const aliceList = await aliceClient.callTool({ name: 'list_images', arguments: {} });
  const aliceImages = (aliceList.structuredContent as any).images;
  assert.ok(aliceImages.some((i: any) => i.id === aliceImgId), 'Alice must see her own image');

  // 2. Connect Bob's scoped MCP server
  const bobServer = buildDropImgServer({ user: { id: bobId, role: 'user' } });
  const bobClient = new Client({ name: 'bob-client', version: '1.0.0' });
  const [bClientTransport, bServerTransport] = InMemoryTransport.createLinkedPair();
  await bobServer.connect(bServerTransport);
  await bobClient.connect(bClientTransport);

  // Bob lists images -> must NOT see Alice's image!
  const bobList = await bobClient.callTool({ name: 'list_images', arguments: {} });
  const bobImages = (bobList.structuredContent as any).images;
  assert.equal(
    bobImages.some((i: any) => i.id === aliceImgId),
    false,
    'Bob must NOT see Alice private image in gallery'
  );

  // Bob tries to get Alice's image -> rejected/not found
  const bobGet = await bobClient.callTool({ name: 'get_image', arguments: { id: aliceImgId } });
  assert.equal(bobGet.isError, true, 'Bob should not be able to fetch Alice private image metadata');

  // Bob tries to delete Alice's image -> rejected
  const bobDelete = await bobClient.callTool({ name: 'delete_image', arguments: { id: aliceImgId } });
  assert.equal(bobDelete.isError, true, 'Bob should not be able to delete Alice image');

  // 3. Alice deletes her own image -> should succeed without deleteToken!
  const aliceDelete = await aliceClient.callTool({ name: 'delete_image', arguments: { id: aliceImgId } });
  assert.ok(!aliceDelete.isError, 'Owner (Alice) must be able to delete without deleteToken');

  await aliceClient.close();
  await aliceServer.close();
  await bobClient.close();
  await bobServer.close();
});

test('MCP Auth: Personal API Keys generation and resolution', async () => {
  const testUserId = `user_keys_${Date.now()}`;
  db.insert(userTable)
    .values({
      id: testUserId,
      name: 'Key Tester',
      email: `${testUserId}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'user',
    })
    .run();

  const { key, keyHash, keyPrefix } = generateApiKey();
  const keyId = `key_${Date.now()}`;

  db.insert(apiKeys)
    .values({
      id: keyId,
      userId: testUserId,
      name: 'Cursor MCP Key',
      keyHash,
      keyPrefix,
      createdAt: new Date(),
    })
    .run();

  // Test token resolution with valid key
  const identity = await resolveMcpIdentity(key);
  assert.ok(identity, 'Should resolve identity for valid API key');
  assert.equal(identity.user?.id, testUserId);
  assert.equal(identity.isAdmin, false);

  // Test token resolution with invalid key
  const badIdentity = await resolveMcpIdentity('drop_sec_invalid_token_12345');
  assert.equal(badIdentity, null, 'Should return null for invalid key');

  // Test master admin token resolution
  config.adminToken = 'master-test-admin-secret';
  const adminIdentity = await resolveMcpIdentity('master-test-admin-secret');
  assert.ok(adminIdentity?.isAdmin);
});

test('MCP Hono Route: Bearer authentication', async () => {
  const app = new Hono();
  config.adminToken = 'secret-admin-token';
  config.publicMode = false;
  app.route('/api/mcp', mcpRoute);

  // Unauthenticated request should be rejected (401)
  const unauthRes = await app.request('/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(unauthRes.status, 401);

  // Options request (CORS) should pass with 204
  const optionsRes = await app.request('/api/mcp', {
    method: 'OPTIONS',
  });
  assert.equal(optionsRes.status, 204);
});
