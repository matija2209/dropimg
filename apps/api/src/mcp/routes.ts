import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildDropImgServer } from './server.js';
import { resolveMcpIdentity, type ResolvedMcpIdentity } from '../lib/mcp-auth.js';
import { config } from '../config.js';

const mcpRoute = new Hono<{
  Variables: {
    mcpIdentity?: ResolvedMcpIdentity;
  };
}>();

const handler = createMcpHandler((ctx) => buildDropImgServer(ctx));

mcpRoute.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const authHeader = c.req.header('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = c.req.query('token') || '';
  const token = bearerToken || queryToken;

  const identity = await resolveMcpIdentity(token, c.req.raw.headers);

  if (!identity && !config.publicMode) {
    return c.json(
      { error: 'Unauthorized: Valid User API Key, Better Auth Bearer token, or Master token required.' },
      401
    );
  }

  if (identity) {
    c.set('mcpIdentity', identity);
  }

  await next();
});

mcpRoute.all('*', async (c) => {
  const identity = c.get('mcpIdentity');
  const authInfo = identity
    ? {
        token: 'mcp-token',
        clientId: identity.user?.id || 'mcp',
        scopes: ['mcp'],
        ...identity,
      }
    : undefined;
  return handler.fetch(c.req.raw, { authInfo });
});

export default mcpRoute;
