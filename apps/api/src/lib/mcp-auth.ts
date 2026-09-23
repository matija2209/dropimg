import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys, user as userTable } from '../db/schema.js';
import { config } from '../config.js';
import { auth } from './auth.js';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const secret = randomBytes(24).toString('base64url');
  const key = `drop_sec_${secret}`;
  const keyHash = hashApiKey(key);
  const keyPrefix = `${key.slice(0, 13)}...${key.slice(-4)}`;
  return { key, keyHash, keyPrefix };
}

export type ResolvedMcpIdentity = {
  user?: {
    id: string;
    role?: string;
  };
  isAdmin: boolean;
  isMaster?: boolean;
};

export async function resolveMcpIdentity(
  token: string,
  rawHeaders?: Headers
): Promise<ResolvedMcpIdentity | null> {
  const cleanToken = token.trim();

  // 1. Check Master / System tokens
  if (config.adminToken && cleanToken === config.adminToken) {
    return { isAdmin: true, isMaster: true };
  }
  if (config.mcpApiKey && cleanToken === config.mcpApiKey) {
    return { isAdmin: true, isMaster: true };
  }
  if (config.internalUploadSecret && cleanToken === config.internalUploadSecret) {
    return { isAdmin: true, isMaster: true };
  }

  // 2. Check Personal API Keys (api_keys table)
  if (cleanToken.startsWith('drop_sec_') || cleanToken.length >= 20) {
    const keyHash = hashApiKey(cleanToken);
    const keyRecord = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, keyHash),
      with: { user: true },
    });

    if (keyRecord) {
      if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() < Date.now()) {
        return null; // Expired key
      }

      // Update lastUsedAt asynchronously
      db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyRecord.id))
        .run();

      const userRole = keyRecord.user?.role || 'user';
      return {
        user: {
          id: keyRecord.userId,
          role: userRole,
        },
        isAdmin: userRole === 'admin',
      };
    }
  }

  // 3. Check Better Auth session token (Bearer session)
  const headers = new Headers(rawHeaders);
  if (!headers.has('authorization') && cleanToken) {
    headers.set('authorization', `Bearer ${cleanToken}`);
  }

  try {
    const session = await auth.api.getSession({ headers });
    if (session?.user) {
      const userRole = session.user.role || 'user';
      return {
        user: {
          id: session.user.id,
          role: userRole,
        },
        isAdmin: userRole === 'admin',
      };
    }
  } catch {
    // Session lookup failed
  }

  return null;
}
