import assert from 'node:assert/strict';
import test from 'node:test';
import llmsRoute from './llms-txt.js';

test('llms.txt standard: GET /llms.txt returns concise markdown reference for LLMs', async () => {
  const req = new Request('http://localhost/llms.txt');
  const res = await llmsRoute.fetch(req);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');

  const text = await res.text();
  assert.match(text, /^# DropImg/m);
  assert.match(text, /> DropImg is a high-performance image and video hosting service/i);
  assert.match(text, /## AI Agent Integration \(MCP\)/i);
  assert.match(text, /upload_video/);
  assert.match(text, /upload_image/);
  assert.match(text, /request_upload_url/);
  assert.match(text, /curl -s -X POST/);
});

test('llms-full.txt standard: GET /llms-full.txt returns complete API reference and schemas', async () => {
  const req = new Request('http://localhost/llms-full.txt');
  const res = await llmsRoute.fetch(req);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');

  const text = await res.text();
  assert.match(text, /# Complete API Reference & Schemas/i);
  assert.match(text, /Personal API Keys/i);
  assert.match(text, /OAuth 2\.0/i);
  assert.match(text, /GET \/raw\/:storageKey/);
});
