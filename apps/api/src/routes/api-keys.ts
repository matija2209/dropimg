import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { authMiddleware } from '../lib/middleware.js';
import { generateApiKey } from '../lib/mcp-auth.js';
import type { auth } from '../lib/auth.js';

const apiKeysRoute = new Hono<{
  Variables: {
    user?: typeof auth.$Infer.Session.user;
    session?: typeof auth.$Infer.Session.session;
  };
}>();

apiKeysRoute.use('*', authMiddleware);

// List user's active API keys
apiKeysRoute.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, user.id),
    orderBy: [desc(apiKeys.createdAt)],
  });

  return c.json(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
    }))
  );
});

// Create a new API key
apiKeysRoute.post('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: { name?: string; expiresDays?: number };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Personal API Key';
  const id = Math.random().toString(36).substring(2, 12);
  const { key, keyHash, keyPrefix } = generateApiKey();

  let expiresAt: Date | null = null;
  if (typeof body.expiresDays === 'number' && body.expiresDays > 0) {
    expiresAt = new Date(Date.now() + body.expiresDays * 86400000);
  }

  db.insert(apiKeys)
    .values({
      id,
      userId: user.id,
      name,
      keyHash,
      keyPrefix,
      createdAt: new Date(),
      expiresAt,
    })
    .run();

  return c.json(
    {
      id,
      name,
      key, // Returned ONLY on creation
      keyPrefix,
      createdAt: new Date(),
      expiresAt,
    },
    201
  );
});

// Delete / Revoke an API key
apiKeysRoute.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const existing = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)),
  });

  if (!existing) {
    return c.json({ error: 'API key not found' }, 404);
  }

  db.delete(apiKeys).where(eq(apiKeys.id, id)).run();

  return c.json({ success: true });
});

export default apiKeysRoute;
