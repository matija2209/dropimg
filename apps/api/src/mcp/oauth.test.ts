import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from 'better-auth/plugins';
import { auth } from '../lib/auth.js';
import { config } from '../config.js';
import mcpRoute from './routes.js';
import { resolveMcpIdentity } from '../lib/mcp-auth.js';
import { db } from '../db/client.js';
import { user as userTable, oauthApplication, oauthAccessToken } from '../db/schema.js';
import { eq } from 'drizzle-orm';

function createTestApp() {
  const app = new Hono();

  // Better Auth handler and RFC 9207 iss middleware
  app.use('/api/auth/mcp/authorize', async (c, next) => {
    await next();
    const loc = c.res.headers.get('Location');
    if (c.res.status >= 300 && c.res.status < 400 && loc && !loc.startsWith('/')) {
      try {
        const issuer = config.publicBaseUrl.replace(/\/$/, '');
        const issuerOrigin = new URL(issuer).origin;
        const u = new URL(loc);
        if (u.origin !== issuerOrigin && !u.searchParams.has('iss')) {
          u.searchParams.set('iss', issuer);
          c.res.headers.set('Location', u.href);
        }
      } catch {
        // Ignore URL parsing errors
      }
    }
  });

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  const discoveryHandler = oAuthDiscoveryMetadata(auth);
  const prmHandler = oAuthProtectedResourceMetadata(auth);

  const handleDiscovery = async (c: any) => {
    const issuer = config.publicBaseUrl.replace(/\/$/, '');
    const req = new Request(new URL(c.req.path, issuer), {
      headers: c.req.raw.headers,
    });
    const upstream = await discoveryHandler(req);
    const body = (await upstream.json()) as Record<string, unknown>;
    body.authorization_response_iss_parameter_supported = true;
    return c.json(body, upstream.status as any);
  };

  app.get('/.well-known/oauth-authorization-server', handleDiscovery);
  app.get('/.well-known/openid-configuration', handleDiscovery);

  const handlePrm = async (c: any) => {
    const issuer = config.publicBaseUrl.replace(/\/$/, '');
    const req = new Request(new URL(c.req.path, issuer), {
      headers: c.req.raw.headers,
    });
    const upstream = await prmHandler(req);
    const body = (await upstream.json()) as Record<string, unknown>;
    return c.json(body, upstream.status as any);
  };

  app.get('/.well-known/oauth-protected-resource', handlePrm);
  app.get('/.well-known/oauth-protected-resource/*', handlePrm);

  app.route('/api/mcp', mcpRoute);

  return app;
}

test('OAuth: RFC 8414 Authorization Server Metadata endpoint', async () => {
  const app = createTestApp();
  const res = await app.request('/.well-known/oauth-authorization-server');

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.issuer, 'Must include issuer');
  assert.ok(data.authorization_endpoint, 'Must include authorization_endpoint');
  assert.ok(data.token_endpoint, 'Must include token_endpoint');
  assert.ok(data.registration_endpoint, 'Must include registration_endpoint for dynamic registration');
  assert.equal(data.authorization_response_iss_parameter_supported, true, 'Must advertise RFC 9207 support');
});

test('OAuth: RFC 9728 Protected Resource Metadata endpoint', async () => {
  const app = createTestApp();

  const res1 = await app.request('/.well-known/oauth-protected-resource');
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.resource, 'Must declare resource');
  assert.ok(Array.isArray(data1.authorization_servers), 'Must list authorization_servers');

  const res2 = await app.request('/.well-known/oauth-protected-resource/api/mcp');
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.resource);
});

test('OAuth: MCP unauthenticated request returns 401 with WWW-Authenticate challenge', async () => {
  const app = createTestApp();
  const res = await app.request('/api/mcp', { method: 'POST' });

  assert.equal(res.status, 401);
  const wwwAuth = res.headers.get('WWW-Authenticate');
  assert.ok(wwwAuth, 'Must include WWW-Authenticate header');
  assert.ok(wwwAuth.includes('Bearer'), 'Header should be Bearer challenge');
  assert.ok(wwwAuth.includes('resource_metadata='), 'Header should include resource_metadata per RFC 9728');
});

test('OAuth: Dynamic Client Registration via Better Auth MCP plugin', async () => {
  const app = createTestApp();

  const regRes = await app.request('/api/auth/mcp/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude Test Client',
      redirect_uris: ['http://localhost:8090/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }),
  });

  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  const clientId = regData.client_id || regData.clientId;
  const clientSecret = regData.client_secret || regData.clientSecret;
  assert.ok(clientId, 'Should return generated client_id');
  assert.ok(clientSecret, 'Should return generated client_secret');
});

test('OAuth: resolveMcpIdentity authenticates users with OAuth access tokens', async () => {
  const testUserId = `oauth_user_${Date.now()}`;
  const testAppId = `oauth_app_${Date.now()}`;
  const testToken = `drop_oauth_tok_${Date.now()}`;

  // Create test user
  db.insert(userTable).values({
    id: testUserId,
    name: 'OAuth Test User',
    email: `${testUserId}@example.com`,
    emailVerified: true,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  // Create test oauth application
  db.insert(oauthApplication).values({
    id: testAppId,
    name: 'Claude Test Runner',
    clientId: testAppId,
    redirectUrls: 'http://localhost:8090/callback',
    type: 'web',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  // Create test oauth access token
  db.insert(oauthAccessToken).values({
    id: `tok_id_${Date.now()}`,
    accessToken: testToken,
    clientId: testAppId,
    userId: testUserId,
    scopes: 'openid profile mcp',
    accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  }).run();

  const identity = await resolveMcpIdentity(testToken);
  assert.ok(identity, 'Should resolve identity from oauthAccessToken');
  assert.equal(identity.user?.id, testUserId);
  assert.equal(identity.isAdmin, false);

  // Clean up
  db.delete(oauthAccessToken).where(eq(oauthAccessToken.accessToken, testToken)).run();
  db.delete(oauthApplication).where(eq(oauthApplication.id, testAppId)).run();
  db.delete(userTable).where(eq(userTable.id, testUserId)).run();
});
