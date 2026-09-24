import crypto from 'node:crypto';
import { config } from '../config.js';
import type { UploadMode } from '../services/image-processing.js';

export interface UploadTicketPayload {
  ticketId: string;
  userId: string;
  filename?: string;
  altName?: string;
  mode?: UploadMode;
  quality?: number;
  exp: number; // Unix timestamp in ms
}

interface TicketRecord {
  exp: number;
  consumed: boolean;
  result?: Record<string, unknown>;
}

// In-memory replay protection and result cache for tickets
const ticketStore = new Map<string, TicketRecord>();

/**
 * Periodically purge expired tickets from memory.
 */
function cleanupExpiredTickets() {
  const now = Date.now();
  for (const [id, record] of ticketStore.entries()) {
    if (record.exp < now) {
      ticketStore.delete(id);
    }
  }
}

// Run cleanup every 5 minutes
const cleanupTimer = setInterval(cleanupExpiredTickets, 5 * 60 * 1000);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Creates an HMAC-SHA256 signed single-use upload ticket.
 */
export function createUploadTicket(params: {
  userId: string;
  filename?: string;
  altName?: string;
  mode?: UploadMode;
  quality?: number;
  expiresInSeconds?: number;
}): { ticket: string; ticketId: string; expiresAt: Date } {
  const ticketId = `tkt_${crypto.randomBytes(16).toString('hex')}`;
  const expiresInSeconds = params.expiresInSeconds || 15 * 60; // 15 minutes default
  const exp = Date.now() + expiresInSeconds * 1000;
  const expiresAt = new Date(exp);

  const payload: UploadTicketPayload = {
    ticketId,
    userId: params.userId,
    filename: params.filename,
    altName: params.altName,
    mode: params.mode,
    quality: params.quality,
    exp,
  };

  const payloadStr = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadStr, 'utf8').toString('base64url');

  const secret = config.auth.secret || 'dropimg-upload-ticket-secret';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(encodedPayload);
  const signature = hmac.digest('base64url');

  const ticket = `${encodedPayload}.${signature}`;

  // Pre-register ticket in store so we can track consumption and store result
  ticketStore.set(ticketId, { exp, consumed: false });

  return { ticket, ticketId, expiresAt };
}

/**
 * Verifies the ticket signature, expiration, and ensures single-use consumption.
 */
export function verifyAndConsumeUploadTicket(
  ticketString: string
): { valid: true; payload: UploadTicketPayload } | { valid: false; error: string; statusCode: number } {
  if (!ticketString || typeof ticketString !== 'string') {
    return { valid: false, error: 'Upload ticket is missing or invalid.', statusCode: 400 };
  }

  const parts = ticketString.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid ticket format.', statusCode: 400 };
  }

  const [encodedPayload, signature] = parts;
  const secret = config.auth.secret || 'dropimg-upload-ticket-secret';

  // Verify HMAC signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(encodedPayload);
  const expectedSignature = hmac.digest('base64url');

  try {
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
    if (!isMatch) {
      return { valid: false, error: 'Invalid ticket signature.', statusCode: 401 };
    }
  } catch {
    return { valid: false, error: 'Invalid ticket signature.', statusCode: 401 };
  }

  // Parse payload
  let payload: UploadTicketPayload;
  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    payload = JSON.parse(decoded) as UploadTicketPayload;
  } catch {
    return { valid: false, error: 'Failed to parse ticket payload.', statusCode: 400 };
  }

  // Check expiration
  if (Date.now() > payload.exp) {
    return { valid: false, error: 'Upload ticket has expired.', statusCode: 410 };
  }

  // Check single-use / replay protection
  const existingRecord = ticketStore.get(payload.ticketId);
  if (existingRecord && existingRecord.consumed) {
    return { valid: false, error: 'Upload ticket has already been used.', statusCode: 409 };
  }

  // Mark as consumed
  ticketStore.set(payload.ticketId, {
    exp: payload.exp,
    consumed: true,
  });

  return { valid: true, payload };
}

/**
 * Stores the resulting image payload so the agent can claim/read it later via ticketId.
 */
export function storeTicketResult(ticketId: string, result: Record<string, unknown>): void {
  const existing = ticketStore.get(ticketId);
  if (existing) {
    existing.result = result;
  } else {
    // Keep in store until expiration (default 15 minutes)
    ticketStore.set(ticketId, {
      exp: Date.now() + 15 * 60 * 1000,
      consumed: true,
      result,
    });
  }
}

/**
 * Retrieves the result associated with a ticketId.
 */
export function getTicketResult(ticketId: string): Record<string, unknown> | null {
  const record = ticketStore.get(ticketId);
  if (!record || !record.result) {
    return null;
  }
  return record.result;
}
