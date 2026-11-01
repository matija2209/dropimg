import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { desc, eq } from 'drizzle-orm';

import { config, storage } from '../config.js';
import { db } from '../db/client.js';
import { documents, type Document } from '../db/schema.js';

const execFileAsync = promisify(execFile);

export const PDF_MIME = 'application/pdf';
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

export type DocumentVisibility = 'private' | 'public';

export class DocumentError extends Error {
  constructor(
    message: string,
    public statusCode: 400 | 413 | 415 | 500 = 400
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

export type DocumentCaller = { id?: string | null; isAdmin?: boolean };

export function isPdfFileName(fileName: string | undefined): boolean {
  return Boolean(fileName && fileName.toLowerCase().endsWith('.pdf'));
}

/** The file's bytes must begin with `%PDF-`; the extension and Content-Type are not trusted. */
export function hasPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

export function maxDocumentBytes(): number {
  return config.maxDocumentUploadMb * 1024 * 1024;
}

/** Strips directories and control characters; keeps the user's own filename otherwise. */
export function sanitizeOriginalFilename(name: string | undefined): string {
  const base = basename((name || '').replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return base || 'document.pdf';
}

function asciiSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return slug || 'document.pdf';
}

/** `inline; filename="<original name>"`, plus an RFC 5987 form for non-ASCII names. */
export function contentDispositionInline(originalFilename: string): string {
  const ascii = originalFilename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(originalFilename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return /^[\x20-\x7e]*$/.test(originalFilename)
    ? `inline; filename="${ascii}"`
    : `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ---- Page count -----------------------------------------------------------

async function pageCountViaPdfinfo(buffer: Buffer): Promise<number | null> {
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), 'dropimg-pdf-'));
    const file = join(dir, 'in.pdf');
    await writeFile(file, buffer);
    const { stdout } = await execFileAsync('pdfinfo', [file], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Best effort: reads `/Type /Pages ... /Count N` from uncompressed page-tree objects. */
export function pageCountFromScan(buffer: Buffer): number | null {
  const text = buffer.toString('latin1');
  let max = 0;
  for (const dict of text.matchAll(/<<[^<>]*\/Type\s*\/Pages\b[^<>]*>>/g)) {
    const count = dict[0].match(/\/Count\s+(\d+)/);
    if (count) max = Math.max(max, Number.parseInt(count[1], 10));
  }
  return max > 0 ? max : null;
}

export async function countPdfPages(buffer: Buffer): Promise<number | null> {
  return (await pageCountViaPdfinfo(buffer)) ?? pageCountFromScan(buffer);
}

// ---- Signed URLs ----------------------------------------------------------

function signingKey(): Buffer {
  return crypto
    .createHmac('sha256', config.auth.secret || 'dropimg-upload-ticket-secret')
    .update('dropimg:document-url:v1')
    .digest();
}

function signature(id: string, expSeconds: number): string {
  return crypto.createHmac('sha256', signingKey()).update(`${id}.${expSeconds}`).digest('base64url');
}

export function clampExpiryHours(requested: number | undefined): number {
  const hours = requested ?? config.documentUrlDefaultHours;
  if (!Number.isFinite(hours) || hours < 1) return config.documentUrlDefaultHours;
  return Math.min(Math.floor(hours), config.documentUrlMaxHours);
}

export function signedDocumentUrl(
  doc: Pick<Document, 'id' | 'originalFilename'>,
  expiresInHours?: number,
  now: number = Date.now()
): { url: string; expiresAt: Date; expiresInHours: number } {
  const hours = clampExpiryHours(expiresInHours);
  const expSeconds = Math.floor(now / 1000) + hours * 3600;
  const url = `${config.documentBaseUrl}/d/${doc.id}/${expSeconds}/${signature(doc.id, expSeconds)}/${encodeURIComponent(asciiSlug(doc.originalFilename))}`;
  return { url, expiresAt: new Date(expSeconds * 1000), expiresInHours: hours };
}

export function permanentDocumentUrl(doc: Pick<Document, 'id' | 'originalFilename'>): string {
  return `${config.documentBaseUrl}/d/${doc.id}/${encodeURIComponent(asciiSlug(doc.originalFilename))}`;
}

export type SignatureCheck = 'ok' | 'invalid' | 'expired';

export function verifyDocumentSignature(id: string, expRaw: string, sig: string, now: number = Date.now()): SignatureCheck {
  if (!/^\d{1,12}$/.test(expRaw)) return 'invalid';
  const expSeconds = Number.parseInt(expRaw, 10);
  const expected = Buffer.from(signature(id, expSeconds));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return 'invalid';
  return now >= expSeconds * 1000 ? 'expired' : 'ok';
}

// ---- Persistence ----------------------------------------------------------

export async function storeDocument(input: {
  buffer: Buffer;
  filename?: string;
  altName?: string | null;
  userId: string;
  visibility?: DocumentVisibility;
  source: string;
}): Promise<Document> {
  const { buffer } = input;
  if (buffer.length === 0) {
    throw new DocumentError('Uploaded file is empty.', 400);
  }
  if (buffer.length > maxDocumentBytes()) {
    throw new DocumentError(`File size exceeds ${config.maxDocumentUploadMb}MB document limit.`, 413);
  }
  if (!hasPdfMagic(buffer)) {
    throw new DocumentError(
      'Uploaded file is not a PDF: its content does not start with "%PDF-". Only PDF documents are supported; the file extension and Content-Type are not trusted.',
      415
    );
  }

  const id = `doc_${crypto.randomBytes(12).toString('hex')}`;
  const storageKey = `documents/${crypto.randomBytes(16).toString('hex')}.pdf`;
  const pageCount = await countPdfPages(buffer);

  // Stored byte-for-byte: no re-encoding, no compression.
  await storage.put({ key: storageKey, body: buffer, mimeType: PDF_MIME });

  const row = {
    id,
    userId: input.userId,
    originalFilename: sanitizeOriginalFilename(input.filename),
    altName: input.altName || null,
    storageKey,
    mimeType: PDF_MIME,
    size: buffer.length,
    pageCount,
    visibility: input.visibility ?? 'private',
    source: input.source,
    createdAt: new Date(),
  } satisfies Document;

  try {
    db.insert(documents).values(row).run();
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  return row;
}

export async function findDocument(id: string): Promise<Document | undefined> {
  return db.query.documents.findFirst({ where: eq(documents.id, id) });
}

export function canAccessDocument(doc: Pick<Document, 'userId'>, caller: DocumentCaller): boolean {
  return Boolean(caller.isAdmin || (caller.id && caller.id === doc.userId));
}

/** Document visible to this caller, or undefined (indistinguishable from not found). */
export async function findDocumentForCaller(id: string, caller: DocumentCaller): Promise<Document | undefined> {
  const doc = await findDocument(id);
  return doc && canAccessDocument(doc, caller) ? doc : undefined;
}

export async function listDocumentsForCaller(
  caller: DocumentCaller,
  opts: { limit: number; offset: number }
): Promise<Document[]> {
  if (!caller.isAdmin && !caller.id) return [];
  const where = caller.isAdmin ? undefined : eq(documents.userId, caller.id!);
  return db.query.documents.findMany({
    where,
    orderBy: [desc(documents.createdAt)],
    limit: opts.limit,
    offset: opts.offset,
  });
}

/** Removes the stored file first, then the row, so a failed storage delete leaves a retryable record. */
export async function deleteDocument(doc: Document): Promise<void> {
  await storage.delete(doc.storageKey);
  db.delete(documents).where(eq(documents.id, doc.id)).run();
}

export function serializeDocument(doc: Document, opts: { expiresInHours?: number; withUrl?: boolean } = {}) {
  const base = {
    id: doc.id,
    mediaType: 'document' as const,
    originalFilename: doc.originalFilename,
    altName: doc.altName,
    mimeType: doc.mimeType,
    size: doc.size,
    pageCount: doc.pageCount,
    visibility: doc.visibility as DocumentVisibility,
    createdAt: doc.createdAt.toISOString(),
  };
  if (opts.withUrl === false) return base;

  const signed = signedDocumentUrl(doc, opts.expiresInHours);
  return {
    ...base,
    url: signed.url,
    urlExpiresAt: signed.expiresAt.toISOString(),
    urlExpiresInHours: signed.expiresInHours,
    ...(doc.visibility === 'public' ? { permanentUrl: permanentDocumentUrl(doc) } : {}),
  };
}
