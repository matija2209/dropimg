# DropImg - AI Agent & Developer Guide (`AGENTS.md`)

This document provides context, architecture details, and operational instructions for AI agents (Claude, Codex, ChatGPT, Cursor, Antigravity, etc.) interacting with or developing on **DropImg**.

---

## 1. Project Overview

DropImg is a high-performance image and video hosting service featuring:
- **Hono & Node.js API** (`apps/api`)
- **React + Vite Frontend** (`apps/web`) with Tailwind CSS and Radix UI
- **Storage Layer**: S3-compatible (local Garage S3 cluster in Docker) or local filesystem
- **Database**: SQLite via Drizzle ORM (`data/app.sqlite` and `apps/api/app.sqlite`)
- **Authentication**: Better Auth with email/password, admin roles, and multi-tenant gallery isolation
- **Model Context Protocol (MCP)**: Native MCP server exposing image hosting, retrieval, variants, and AI vision tools

---

## 2. Model Context Protocol (MCP) & OAuth 2.0

DropImg features a built-in MCP server conforming to the modern MCP specification (using `@modelcontextprotocol/server`, `@modelcontextprotocol/hono`, and Better Auth's `mcp` plugin).

### Remote Endpoint
- **Base MCP URL**: `https://img.buildwithmatija.com/api/mcp` (or `http://localhost:3000/api/mcp` in local dev)
- **Transports**: Streamable HTTP / Server-Sent Events (remote) and `stdio` (`npm run mcp:stdio --workspace=@dropimg/api`)

### OAuth 2.0 / OIDC Architecture (For Claude, ChatGPT, Codex)
External AI agents authenticate via standard OAuth 2.0 discovery and authorization code flows:

1. **RFC 9728 Protected Resource Metadata**:
   - `GET /.well-known/oauth-protected-resource`
   - `GET /.well-known/oauth-protected-resource/api/mcp`
   - Returns resource URL, authorization servers, and supported scopes (`openid`, `profile`, `email`, `offline_access`).
2. **RFC 8414 Authorization Server Discovery**:
   - `GET /.well-known/oauth-authorization-server`
   - `GET /.well-known/openid-configuration`
   - Publishes authorization, token, registration, and JWKS endpoints, advertising `authorization_response_iss_parameter_supported: true`.
3. **RFC 7591 Dynamic Client Registration**:
   - `POST /api/auth/mcp/register`
   - External clients (e.g. Claude Desktop) dynamically register with their client name and redirect URIs to obtain a `client_id` and `client_secret`.
4. **RFC 7636 PKCE Authorization Code Grant**:
   - `GET /api/auth/mcp/authorize`
   - Directs user to log in at `/login` (if not already authenticated) and approve access.
5. **RFC 9207 `iss` Protection**:
   - Authorization redirects back to client's `redirect_uri` include the `iss` parameter (`iss=https://img.buildwithmatija.com`).
6. **Token Exchange**:
   - `POST /api/auth/mcp/token`
   - Exchanges code + PKCE verifier for an OAuth Bearer access token.
7. **Unauthenticated Challenge (RFC 9728)**:
   - Requests to `/api/mcp` without valid auth receive `401 Unauthorized` with:
     ```http
     WWW-Authenticate: Bearer error="invalid_token", error_description="Unauthorized: Valid User API Key, OAuth Bearer token, or Session token required", resource_metadata="https://img.buildwithmatija.com/.well-known/oauth-protected-resource/api/mcp"
     ```

### Alternative Authentication Options
- **Personal API Keys**: Permanent keys (`drop_sec_...`) generated via `POST /api/user/api-keys`, passed in `Authorization: Bearer <key>`. Ideal for Cursor or CLI.
- **Session Tokens**: Better Auth cookie/bearer session tokens.
- **Master Tokens**: `ADMIN_TOKEN` or `MCP_API_KEY` for administrative tasks.

---

## 3. MCP Capabilities

### Tools
- **`upload_image`**:
  - Inputs: `imageData` (base64 string / Data URL) or `imageUrl` (public web link), `altName`, `mode` (`upload`, `compress-jpg`, `png-to-jpg`, `strip-metadata`, `remove-background`), `quality` (1-100).
  - Automatically generates responsive variants (`thumbnail`, `card`, `tablet`, `social`).
  - Returns direct raw URL, view page URL, Markdown embed code, responsive `<picture>` tag, and delete token.
  - Automatically saved to the authenticated caller's private gallery (`userId`).
- **`get_image`**:
  - Inputs: `id` (or storage filename), `variant` (`original`, `thumbnail`, `card`, `tablet`, `social`), `includeImageData` (boolean).
  - When `includeImageData: true`, returns native MCP base64 image data for multimodal vision models to inspect visually.
- **`list_images`**:
  - Inputs: `limit` (max 100), `offset`.
  - Scoped to the authenticated caller's gallery (or all images for admins).
- **`delete_image`**:
  - Inputs: `id`, optional `deleteToken` (owners do not need a delete token).
  - Removes the image and all variants from storage and database.

### Resources & Prompts
- **Resource `dropimg://images/{id}`**: Direct JSON metadata, variant links, and dimensions.
- **Prompt `embed_image`**: Generates pre-formatted Markdown and responsive HTML `<picture>` snippets with custom alt text.

---

## 4. Development & Testing Commands

```bash
# Run unit & integration test suite (17 tests covering MCP tools, OAuth discovery, image processing)
npm test --workspace=@dropimg/api

# Build all workspaces (TypeScript & Vite)
npm run build

# Start local API dev server
npm run dev --workspace=@dropimg/api

# Run local MCP stdio server
npm run mcp:stdio --workspace=@dropimg/api

# Push database schema changes via Drizzle
DATABASE_URL=file:./data/app.sqlite npm run db:push --workspace=@dropimg/api

# Rebuild and restart production Docker container
docker compose build dropimg && docker compose up -d dropimg
```
