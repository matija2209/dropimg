import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import sharp from 'sharp';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { buildDropImgServer } from './server.js';
import { db } from '../db/client.js';
import { documents, user as userTable } from '../db/schema.js';
import { config } from '../config.js';
import directUpload from '../routes/direct-upload.js';
import documentsRoute, { isDocumentHostRequest } from '../routes/documents.js';
import { hasPdfMagic, pageCountFromScan, signedDocumentUrl } from '../services/documents.js';

const SAMPLE_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n',
  'latin1'
);

const app = new Hono();
app.route('/api/upload/direct', directUpload);
app.route('/', documentsRoute);

async function seedUser(prefix: string) {
  const id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.insert(userTable)
    .values({ id, name: prefix, email: `${id}@test.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
    .run();
  return id;
}

async function connect(context: Record<string, unknown>) {
  const server = buildDropImgServer(context);
  const client = new Client({ name: 'doc-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function uploadPdf(client: Client, body: Buffer, filename: string, args: Record<string, unknown> = {}) {
  const ticketResult = await client.callTool({
    name: 'request_upload_url',
    arguments: { filename, mediaType: 'document', ...args },
  });
  assert.ok(!ticketResult.isError, JSON.stringify(ticketResult.content));
  const ticket = ticketResult.structuredContent as any;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(body)], { type: 'application/pdf' }), filename);
  const res = await app.fetch(new Request(ticket.uploadUrl, { method: 'POST', body: form }));
  return { ticket, res };
}

test('Documents: PDF magic-byte and page-count helpers', () => {
  assert.equal(hasPdfMagic(SAMPLE_PDF), true);
  assert.equal(hasPdfMagic(Buffer.from('<html>%PDF-</html>')), false);
  assert.equal(hasPdfMagic(Buffer.alloc(0)), false);
  assert.equal(pageCountFromScan(SAMPLE_PDF), 2);
});

test('Documents: upload → claim → inline serve → expiry → fresh link → delete', async () => {
  const userId = await seedUser('docowner');
  const client = await connect({ user: { id: userId, role: 'user' } });

  // request_upload_url advertises document support and returns a curl command
  const tools = await client.listTools();
  const requestTool = tools.tools.find((t) => t.name === 'request_upload_url')!;
  assert.match(requestTool.description!, /document/i);
  assert.match(requestTool.description!, /expire/i);
  assert.ok(tools.tools.some((t) => t.name === 'get_document'));

  const { ticket, res } = await uploadPdf(client, SAMPLE_PDF, 'SOW.pdf');
  assert.equal(ticket.mediaType, 'document');
  assert.match(ticket.curlCommand, /curl -s -X POST -F "file=@SOW.pdf"/);

  assert.equal(res.status, 201, await res.clone().text());
  const uploaded = (await res.json()) as any;
  assert.match(uploaded.id, /^doc_/);
  assert.equal(uploaded.visibility, 'private');
  assert.equal(uploaded.originalFilename, 'SOW.pdf');
  assert.equal(uploaded.size, SAMPLE_PDF.length);
  assert.equal(uploaded.pageCount, 2);
  assert.equal(uploaded.permanentUrl, undefined, 'private documents have no permanent URL');

  const row = db.select().from(documents).where(eq(documents.id, uploaded.id)).get()!;
  assert.equal(row.userId, userId);
  assert.match(row.storageKey, /^documents\/[0-9a-f]{32}\.pdf$/);
  const storedPath = join(config.uploadDir, row.storageKey);
  assert.ok(existsSync(storedPath), 'file must be stored');

  // claim_upload_ticket → signed URL that expires, default 7 days
  const claim = await client.callTool({ name: 'claim_upload_ticket', arguments: { ticketId: ticket.ticketId } });
  assert.ok(!claim.isError, JSON.stringify(claim.content));
  const claimed = claim.structuredContent as any;
  assert.equal(claimed.id, uploaded.id);
  assert.equal(claimed.urlExpiresInHours, 24 * 7);
  assert.ok(Math.abs(Date.parse(claimed.urlExpiresAt) - (Date.now() + 7 * 86400_000)) < 60_000);
  assert.equal(claimed.permanentUrl, undefined);

  // Signed URL serves the PDF inline with hardened headers, byte-for-byte
  const served = await app.fetch(new Request(claimed.url));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'application/pdf');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(served.headers.get('content-disposition'), 'inline; filename="SOW.pdf"');
  assert.match(served.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), SAMPLE_PDF);

  // Range requests work (PDF viewers use them) and keep the same headers
  const ranged = await app.fetch(new Request(claimed.url, { headers: { Range: 'bytes=0-4' } }));
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), '%PDF-');
  assert.equal(ranged.headers.get('x-content-type-options'), 'nosniff');

  // No permanent public URL: unsigned path is 404 for private documents; /raw-style key access is not offered
  const permanent = await app.fetch(new Request(`${config.documentBaseUrl}/d/${uploaded.id}/SOW.pdf`));
  assert.equal(permanent.status, 404);

  // Tampered signature / expiry are rejected with 403
  const urlParts = claimed.url.split('/');
  const sigIndex = urlParts.length - 2;
  const flipped = urlParts[sigIndex].slice(0, -1) + (urlParts[sigIndex].endsWith('A') ? 'B' : 'A');
  const tampered = [...urlParts.slice(0, sigIndex), flipped, urlParts[sigIndex + 1]].join('/');
  assert.equal((await app.fetch(new Request(tampered))).status, 403);
  const [, expPart] = new URL(claimed.url).pathname.match(/\/d\/[^/]+\/(\d+)\//)!;
  const extended = claimed.url.replace(`/${expPart}/`, `/${Number(expPart) + 86400}/`);
  assert.equal((await app.fetch(new Request(extended))).status, 403, 'cannot extend expiry by editing the URL');

  const expired = signedDocumentUrl(row, 1, Date.now() - 2 * 3600_000);
  const expiredRes = await app.fetch(new Request(expired.url));
  assert.equal(expiredRes.status, 403);
  assert.match(((await expiredRes.json()) as any).error, /expired/i);

  // get_document mints a fresh link; expiresInHours is honoured and capped at 30 days
  const fresh = await client.callTool({ name: 'get_document', arguments: { id: uploaded.id, expiresInHours: 2 } });
  assert.ok(!fresh.isError);
  const freshData = fresh.structuredContent as any;
  assert.equal(freshData.urlExpiresInHours, 2);
  const freshRes = await app.fetch(new Request(freshData.url));
  assert.equal(freshRes.status, 200);
  await freshRes.arrayBuffer(); // drain the file stream before the document is deleted
  const tooLong = await client.callTool({ name: 'get_document', arguments: { id: uploaded.id, expiresInHours: 24 * 31 } });
  assert.ok(tooLong.isError, 'more than 30 days is rejected');

  // list_documents / list_images(mediaType=document) show it; no links in the list
  const listed = await client.callTool({ name: 'list_documents', arguments: {} });
  const listedDocs = (listed.structuredContent as any).documents;
  assert.ok(listedDocs.some((d: any) => d.id === uploaded.id));
  assert.equal(listedDocs[0].url, undefined);
  const viaImages = await client.callTool({ name: 'list_images', arguments: { mediaType: 'document' } });
  assert.ok((viaImages.structuredContent as any).documents.some((d: any) => d.id === uploaded.id));
  const plainImages = await client.callTool({ name: 'list_images', arguments: {} });
  assert.ok(!JSON.stringify(plainImages.structuredContent).includes(uploaded.id), 'documents never appear in the image gallery');

  // delete_image works for documents and removes the stored file; the old URL then 404s
  const del = await client.callTool({ name: 'delete_image', arguments: { id: uploaded.id } });
  assert.ok(!del.isError, JSON.stringify(del.content));
  assert.equal(existsSync(storedPath), false, 'stored file must be removed');
  assert.equal(db.select().from(documents).where(eq(documents.id, uploaded.id)).get(), undefined);
  assert.equal((await app.fetch(new Request(freshData.url))).status, 404);
  const gone = await client.callTool({ name: 'get_document', arguments: { id: uploaded.id } });
  assert.ok(gone.isError);

  db.delete(userTable).where(eq(userTable.id, userId)).run();
});

test('Documents: a PNG renamed to .pdf is rejected, and nothing is stored', async () => {
  const userId = await seedUser('docreject');
  const client = await connect({ user: { id: userId, role: 'user' } });

  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
  const { res } = await uploadPdf(client, png, 'fake.pdf');
  assert.equal(res.status, 415);
  assert.match(((await res.json()) as any).error, /not a PDF/i);
  assert.equal(db.select().from(documents).where(eq(documents.userId, userId)).all().length, 0);

  // empty file
  const empty = await uploadPdf(client, Buffer.alloc(0), 'empty.pdf');
  assert.equal(empty.res.status, 400);

  db.delete(userTable).where(eq(userTable.id, userId)).run();
});

test('Documents: size limit, option conflicts and filename inference', async () => {
  const userId = await seedUser('docopts');
  const client = await connect({ user: { id: userId, role: 'user' } });

  // .pdf filename alone infers "document"
  const inferred = await client.callTool({ name: 'request_upload_url', arguments: { filename: 'contract.pdf' } });
  assert.equal((inferred.structuredContent as any).mediaType, 'document');

  // image/video options are rejected with a clear error
  const withMode = await client.callTool({ name: 'request_upload_url', arguments: { filename: 'a.pdf', mode: 'compress-jpg' } });
  assert.ok(withMode.isError);
  assert.match(JSON.stringify(withMode.content), /do not apply to documents/);
  const withTranscode = await client.callTool({ name: 'request_upload_url', arguments: { filename: 'a.pdf', transcode: true } });
  assert.ok(withTranscode.isError);

  // contradictory mediaType / extension
  const mismatch = await client.callTool({ name: 'request_upload_url', arguments: { filename: 'a.pdf', mediaType: 'image' } });
  assert.ok(mismatch.isError);
  assert.match(JSON.stringify(mismatch.content), /document/);
  const notPdfName = await client.callTool({ name: 'request_upload_url', arguments: { filename: 'a.png', mediaType: 'document' } });
  assert.ok(notPdfName.isError);

  // size limit (configurable via MAX_DOCUMENT_UPLOAD_MB)
  const original = config.maxDocumentUploadMb;
  config.maxDocumentUploadMb = 0.0001; // ~100 bytes
  try {
    const big = Buffer.concat([SAMPLE_PDF, Buffer.alloc(500, 0x20)]);
    const { res } = await uploadPdf(client, big, 'big.pdf');
    assert.equal(res.status, 413);
  } finally {
    config.maxDocumentUploadMb = original;
  }

  // anonymous callers cannot create documents
  const anon = await connect({});
  const anonResult = await anon.callTool({ name: 'request_upload_url', arguments: { filename: 'a.pdf' } });
  assert.ok(anonResult.isError);

  db.delete(userTable).where(eq(userTable.id, userId)).run();
});

test('Documents: other users cannot read, claim, list or delete them; public visibility gets a permanent URL', async () => {
  const ownerId = await seedUser('docprivate');
  const strangerId = await seedUser('docstranger');
  const owner = await connect({ user: { id: ownerId, role: 'user' } });
  const stranger = await connect({ user: { id: strangerId, role: 'user' } });

  const { ticket, res } = await uploadPdf(owner, SAMPLE_PDF, 'secret.pdf');
  const uploaded = (await res.json()) as any;

  assert.ok((await stranger.callTool({ name: 'claim_upload_ticket', arguments: { ticketId: ticket.ticketId } })).isError);
  assert.ok((await stranger.callTool({ name: 'get_document', arguments: { id: uploaded.id } })).isError);
  assert.ok((await stranger.callTool({ name: 'delete_document', arguments: { id: uploaded.id } })).isError);
  assert.ok((await stranger.callTool({ name: 'delete_image', arguments: { id: uploaded.id } })).isError);
  const strangerList = await stranger.callTool({ name: 'list_documents', arguments: {} });
  assert.equal((strangerList.structuredContent as any).count, 0);

  // the unauthenticated ticket-status endpoint never exposes a download link
  const status = await app.fetch(new Request(`http://localhost/api/upload/direct/status?ticketId=${ticket.ticketId}`));
  assert.ok(!JSON.stringify(await status.json()).includes('/d/'));

  // admin (e.g. master token) can see it
  const admin = await connect({ isAdmin: true });
  assert.ok(!(await admin.callTool({ name: 'get_document', arguments: { id: uploaded.id } })).isError);

  // public documents additionally get a permanent URL
  const pub = await uploadPdf(owner, SAMPLE_PDF, 'brochure.pdf', { visibility: 'public' });
  const pubDoc = (await pub.res.json()) as any;
  assert.equal(pubDoc.visibility, 'public');
  assert.ok(pubDoc.permanentUrl);
  const pubRes = await app.fetch(new Request(pubDoc.permanentUrl));
  assert.equal(pubRes.status, 200);
  assert.equal(pubRes.headers.get('content-type'), 'application/pdf');
  assert.equal(pubRes.headers.get('x-content-type-options'), 'nosniff');
  await pubRes.arrayBuffer();

  await owner.callTool({ name: 'delete_document', arguments: { id: uploaded.id } });
  await owner.callTool({ name: 'delete_document', arguments: { id: pubDoc.id } });
  db.delete(userTable).where(eq(userTable.id, ownerId)).run();
  db.delete(userTable).where(eq(userTable.id, strangerId)).run();
});

test('Documents: only answered on the document host, never on the app domain', async () => {
  const original = { app: config.appUrl, doc: config.documentBaseUrl };
  config.appUrl = 'https://img.example.com';
  config.documentBaseUrl = 'https://assets.example-cdn.net';
  try {
    const headers = (init: Record<string, string>) => new Headers(init);
    // CDN pulling from the app origin: Host is the origin's, CDN-Host is the CDN's
    assert.equal(isDocumentHostRequest(headers({ host: 'img.example.com', 'cdn-host': 'assets.example-cdn.net' })), true);
    // Direct visit to the app domain
    assert.equal(isDocumentHostRequest(headers({ host: 'img.example.com' })), false);
    // A different CDN host is not the document host
    assert.equal(isDocumentHostRequest(headers({ host: 'img.example.com', 'cdn-host': 'other.example.net' })), false);
    // Document host reaching the app directly
    assert.equal(isDocumentHostRequest(headers({ host: 'assets.example-cdn.net' })), true);

    const res = await app.fetch(new Request('http://img.example.com/d/doc_x/1/sig/a.pdf', { headers: { host: 'img.example.com' } }));
    assert.equal(res.status, 404);
  } finally {
    config.appUrl = original.app;
    config.documentBaseUrl = original.doc;
  }
});
