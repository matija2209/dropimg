import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import sharp from 'sharp';

import { buildDropImgServer } from './server.js';
import { db } from '../db/client.js';
import { images, imageVariants } from '../db/schema.js';
import { config, storage } from '../config.js';
import mcpRoute from './routes.js';
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
