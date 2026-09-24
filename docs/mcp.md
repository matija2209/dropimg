# DropImg Model Context Protocol (MCP) Server

DropImg includes a built-in **Model Context Protocol (MCP)** server built with `@modelcontextprotocol/server` and `@modelcontextprotocol/hono`.

This allows external AI agents and IDEs (Claude Desktop, Cursor, Antigravity IDE, Zed, Windsurf) to directly **upload**, **retrieve**, **list**, and **delete** hosted images, and receive Markdown embed codes, responsive `<picture>` markup, and base64 image data for multimodal vision.

---

## Private Multi-Tenancy & User Account Isolation

DropImg connects MCP operations directly to your **Better Auth** user account:

- **Private Galleries**: Images uploaded with your personal API key or session token are saved with `userId: user.id`. They immediately appear in your private gallery on the web dashboard.
- **Private Listing**: `list_images` is scoped to your account. You will only see the images you uploaded.
- **Direct Ownership Deletion**: Authenticated owners can delete their images directly without needing a separate `deleteToken`.
- **Master Overrides**: Admins and master tokens (`MCP_API_KEY`, `ADMIN_TOKEN`) can see and manage all images.

---

## Authentication Options

External MCP clients can authenticate using:
1. **OAuth 2.0 / OIDC (Option A - Recommended for Claude, ChatGPT, Codex)**: Full dynamic registration, browser-based authorization code flow with PKCE (RFC 7636), and RFC 9207 `iss` protection.
2. **Personal API Keys (Option B - Recommended for Cursor, CLI, Stdio)**: Permanent secret keys (`drop_sec_...`) scoped to your account.
3. **Better Auth Session Tokens (Option C)**: Ephemeral session tokens passed via Bearer auth.
4. **Master Server Token**: `MCP_API_KEY` or `ADMIN_TOKEN` for administrative tasks.

---

## OAuth 2.0 / OIDC for Claude, ChatGPT, and Codex

DropImg implements standard OAuth 2.0 discovery and authorization according to the Model Context Protocol specification:

- **RFC 8414 Authorization Server Discovery**: `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`
- **RFC 9728 Protected Resource Metadata**: `/.well-known/oauth-protected-resource/api/mcp`
- **RFC 7591 Dynamic Client Registration**: `/api/auth/mcp/register`
- **OAuth Authorization Endpoint**: `/api/auth/mcp/authorize` (redirects to `/login` if not authenticated, returns `code` + `iss` per RFC 9207)
- **OAuth Token Endpoint**: `/api/auth/mcp/token` (exchanges authorization code for Bearer access token)

### Connecting from Claude / ChatGPT

1. In Claude or ChatGPT custom GPT/action configuration, point the MCP server URL to:
   ```
   https://img.buildwithmatija.com/api/mcp
   ```
2. When the client makes an unauthenticated request to `/api/mcp`, DropImg sends a `401 Unauthorized` challenge with the `WWW-Authenticate` header pointing to `/.well-known/oauth-protected-resource/api/mcp`.
3. The client dynamically registers itself via `/api/auth/mcp/register`, opens your browser to authorize your DropImg account, and exchanges the authorization code for an OAuth access token.
4. All images uploaded by the AI agent are securely saved into your private gallery.

---

### Generating a Personal API Key

Users can manage their MCP keys via the REST API (or web dashboard):

#### 1. Create Key
```bash
POST /api/user/api-keys
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "name": "Cursor MCP Key",
  "expiresDays": 365
}
```
**Response (201 Created):**
```json
{
  "id": "key_abc123",
  "name": "Cursor MCP Key",
  "key": "drop_sec_abc123xyz...",
  "keyPrefix": "drop_sec_abc1...xyz",
  "createdAt": "2026-09-23T10:00:00Z"
}
```
*(The raw key is returned only once upon creation).*

#### 2. List Your Keys
```bash
GET /api/user/api-keys
```

#### 3. Revoke a Key
```bash
DELETE /api/user/api-keys/:id
```

---

## Capabilities

### 1. Tools

| Tool | Description | Inputs |
| :--- | :--- | :--- |
| `upload_image` | Upload and host an image on DropImg (saved to your private gallery) | `imageData` (base64) OR `imageUrl` (web link), `altName`, `mode` (`upload`, `compress-jpg`, `png-to-jpg`, `strip-metadata`, `remove-background`), `quality` (1-100) |
| `get_image` | Retrieve metadata, direct URLs, variants, and optional base64 image content | `id`, `variant` (`original`, `thumbnail`, `card`, `tablet`, `social`), `includeImageData` (boolean) |
| `list_images` | List your private images with pagination | `limit` (default 20, max 100), `offset` (default 0) |
| `delete_image` | Delete an image and its variants | `id`, `deleteToken` (not required if you are the owner) |

### 2. Resources
- `dropimg://images/{id}`: Direct metadata and variant links for an image asset.

### 3. Prompts
- `embed_image`: Generates ready-to-use responsive HTML picture tags and Markdown links for an image.

---

## Connection Modes

### Option A: Local stdio (Claude Desktop / Cursor)

You can launch the DropImg MCP server directly as a local stdio process.

#### Claude Desktop Configuration
Add the following to your `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, on Linux: `~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dropimg": {
      "command": "node",
      "args": [
        "/absolute/path/to/dropimg/apps/api/dist/mcp/stdio.js"
      ],
      "env": {
        "DATABASE_URL": "file:/absolute/path/to/dropimg/data/app.sqlite",
        "STORAGE_DRIVER": "local",
        "UPLOAD_DIR": "/absolute/path/to/dropimg/data/uploads",
        "PUBLIC_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

Or run via `tsx` from the repository root:
```json
{
  "mcpServers": {
    "dropimg": {
      "command": "npm",
      "args": [
        "run",
        "mcp:stdio",
        "--workspace=@dropimg/api"
      ],
      "cwd": "/absolute/path/to/dropimg"
    }
  }
}
```

---

### Option B: Remote HTTP / SSE (`/api/mcp`)

When DropImg is running (in Docker or standalone), the MCP server is mounted at:
```
https://img.yourdomain.com/api/mcp
```

#### Authentication
Provide your token via the `Authorization` header:
```http
Authorization: Bearer <PERSONAL_API_KEY or SESSION_TOKEN or MCP_API_KEY>
```
Or as a URL query parameter:
```
https://img.yourdomain.com/api/mcp?token=<TOKEN>
```
