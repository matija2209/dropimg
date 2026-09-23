import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildDropImgServer } from './server.js';
import { config } from '../config.js';

const mcpRoute = new Hono();
const handler = createMcpHandler(buildDropImgServer);

function verifyMcpAuth(c: any): boolean {
  if (config.publicMode) {
    return true;
  }

  const authHeader = c.req.header('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = c.req.query('token') || '';
  const token = bearerToken || queryToken;

  if (!token) {
    return false;
  }

  if (config.mcpApiKey && token === config.mcpApiKey) {
    return true;
  }

  if (config.adminToken && token === config.adminToken) {
    return true;
  }

  if (config.internalUploadSecret && token === config.internalUploadSecret) {
    return true;
  }

  return false;
}

mcpRoute.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (!verifyMcpAuth(c)) {
    return c.json(
      { error: 'Unauthorized: Valid Bearer token or token query parameter required.' },
      401
    );
  }

  await next();
});

mcpRoute.all('*', async (c) => {
  return handler.fetch(c.req.raw);
});

export default mcpRoute;
