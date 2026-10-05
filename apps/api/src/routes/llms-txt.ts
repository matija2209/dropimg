import { Hono } from 'hono';
import { config } from '../config.js';

const llmsRoute = new Hono();

export function generateLlmsTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `# DropImg

> DropImg is a high-performance image and video hosting service featuring automatic responsive WebP variants, HTTP Range video streaming, signed ticket sandbox uploads, and native Model Context Protocol (MCP) server support.

## Core Capabilities
- **Images**: Upload PNG, JPEG, WebP, GIF. Auto-generates responsive variants (thumbnail, card, tablet, social), responsive HTML <picture> markup, and Markdown embeds.
- **Videos**: Upload MP4, WebM, MOV, MKV. Extracts WebP poster frames via FFmpeg, probes dimensions and duration, supports HTTP 206 Partial Content range streaming for HTML5 video playback.
- **AI Agents & MCP**: Native Model Context Protocol server over HTTP SSE / Streamable HTTP with OAuth 2.0 PKCE discovery and Personal API Keys.
- **Container / Sandbox Uploads**: Signed single-use tickets allowing sandboxed agents (Claude Web, code execution bash containers) to upload local files directly via curl without transmitting heavy base64 strings through chat context.

## AI Agent Integration (MCP)
- **MCP Endpoint**: \`${base}/api/mcp\`
- **Authentication**:
  - Personal API Key: \`Authorization: Bearer drop_sec_...\`
  - OAuth 2.0 Bearer: Dynamic client registration via \`/api/auth/mcp/register\`, authorization at \`/api/auth/mcp/authorize\`
- **Key MCP Tools**:
  - \`upload_image\`: Host images from base64 or remote URL (supports background removal and compression).
  - \`upload_video\`: Host MP4/WebM videos from base64 or remote URL (extracts poster frame and duration).
  - \`request_upload_url\`: Generates signed ticket and curl command for container/sandbox files.
  - \`claim_upload_ticket\`: Retrieves hosted URLs and HTML5 video/picture markup after curl upload.
  - \`get_image\`: Inspect metadata, direct URLs, variants, and optional base64 image/poster data for multimodal LLMs.
  - \`list_images\`: Scoped private gallery listing.
  - \`delete_image\`: Removes asset and variants.

## REST API Cheatsheet

### 1. Direct Ticket Upload (Sandboxes & Terminals)
\`\`\`bash
# Upload an image or video directly using a signed ticket
curl -s -X POST -F "file=@screenshot.png" "${base}/api/upload/direct?ticket=<TICKET>"
curl -s -X POST -F "file=@demo.mp4" "${base}/api/upload/direct?ticket=<TICKET>"
\`\`\`

### 2. Standard Upload (Authenticated)
\`\`\`bash
# Requires session cookie or personal API key
curl -s -X POST \\
  -H "Authorization: Bearer drop_sec_..." \\
  -F "file=@photo.jpg" \\
  -F "altName=Sunset" \\
  "${base}/api/upload"
\`\`\`

### 3. File Delivery & Streaming
- View Web Page: \`${base}/i/:id\`
- Direct Raw Object: \`${base}/raw/:storageKey\` (Supports HTTP 206 Range requests for videos)
- Specific Variant: \`${base}/api/images/:id/file/:variant\` (variants: \`original\`, \`thumbnail\`, \`card\`, \`tablet\`, \`social\`, \`poster\`)

## Discovery & Standards
- Authorization Server Discovery: \`${base}/.well-known/oauth-authorization-server\`
- Protected Resource Metadata: \`${base}/.well-known/oauth-protected-resource\`
- OpenID Configuration: \`${base}/.well-known/openid-configuration\`
- Full Documentation: \`${base}/llms-full.txt\`
`;
}

export function generateLlmsFullTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${generateLlmsTxt(base)}

---

# Complete API Reference & Schemas

## 1. Authentication
DropImg supports three authentication mechanisms:

1. **Personal API Keys**:
   - Format: \`drop_sec_<random-alphanumeric>\`
   - Generated via \`POST /api/user/api-keys\`
   - Header: \`Authorization: Bearer drop_sec_...\`
   - Ideal for CLI tools, Cursor, background daemons, and programmatic scripts.

2. **OAuth 2.0 / OIDC Bearer Tokens**:
   - RFC 8414 Discovery: \`${base}/.well-known/oauth-authorization-server\`
   - RFC 9728 Protected Resource Metadata: \`${base}/.well-known/oauth-protected-resource\`
   - Dynamic Client Registration: \`POST /api/auth/mcp/register\`
   - Authorize URL: \`GET /api/auth/mcp/authorize\` (supports PKCE & \`iss\` response parameter)
   - Token Exchange: \`POST /api/auth/mcp/token\`
   - Used by Claude Desktop, ChatGPT Actions, and autonomous AI agents.

3. **Session Cookies**:
   - Used by browser Web UI (Better Auth cookies).

---

## 2. Model Context Protocol (MCP)

Endpoint: \`${base}/api/mcp\`
Transport: HTTP SSE / Streamable HTTP (or stdio via \`npm run mcp:stdio --workspace=@dropimg/api\`)

### Tool: \`upload_image\`
- Parameters:
  - \`imageData\`: string (Base64 data or Data URL) [Optional if imageUrl provided]
  - \`imageUrl\`: string (HTTP/HTTPS URL) [Optional if imageData provided]
  - \`altName\`: string [Optional]
  - \`mode\`: \`'upload' | 'compress-jpg' | 'png-to-jpg' | 'strip-metadata' | 'remove-background'\` (Default: \`upload\`)
  - \`quality\`: integer (1-100) [Optional]
- Returns: \`id\`, \`rawUrl\`, \`pageUrl\`, \`markdown\`, \`responsiveHtml\`, \`variants\`, \`deleteToken\`

### Tool: \`upload_video\`
- Parameters:
  - \`videoData\`: string (Base64 data or Data URL) [Optional if videoUrl provided]
  - \`videoUrl\`: string (HTTP/HTTPS URL) [Optional if videoData provided]
  - \`filename\`: string (e.g. "clip.mp4") [Optional]
  - \`altName\`: string [Optional]
  - \`transcode\`: boolean (Default: false)
- Returns: \`id\`, \`rawUrl\`, \`pageUrl\`, \`videoHtml\`, \`posterUrl\`, \`durationMs\`, \`dimensions\`, \`deleteToken\`

### Tool: \`request_upload_url\`
- Parameters:
  - \`filename\`: string (e.g. "screenshot.png", "clip.mp4") [Optional]
  - \`altName\`: string [Optional]
  - \`mediaType\`: \`'image' | 'video'\` [Optional, auto-inferred from filename extension]
  - \`mode\`: \`'upload' | 'compress-jpg' | 'png-to-jpg' | 'strip-metadata' | 'remove-background'\`
  - \`quality\`: integer (1-100)
  - \`transcode\`: boolean
  - \`expiresInMinutes\`: integer (Default: 15)
- Returns: \`uploadUrl\`, \`ticketId\`, \`curlCommand\`, \`expiresAt\`

### Tool: \`claim_upload_ticket\`
- Parameters:
  - \`ticketId\`: string (e.g. "tkt_...")
- Returns: Complete hosted asset metadata and embed codes once the curl upload completes.

### Tool: \`get_image\`
- Parameters:
  - \`id\`: string (asset ID or storage filename)
  - \`variant\`: \`'original' | 'thumbnail' | 'card' | 'tablet' | 'social' | 'poster'\`
  - \`includeImageData\`: boolean (when true, returns base64 image block for vision models)

### Tool: \`list_images\`
- Parameters:
  - \`limit\`: integer (1-100, default 20)
  - \`offset\`: integer (default 0)

### Tool: \`delete_image\`
- Parameters:
  - \`id\`: string
  - \`deleteToken\`: string [Optional if caller is asset owner]

---

## 3. Storage & Delivery Routes

- \`GET /raw/:storageKey\`: Delivers original file or variant. Returns HTTP 206 Partial Content when request contains \`Range\` header for videos.
- \`GET /api/images/:id/file/:variant\`: Delivers specific image or video variant (\`original\`, \`thumbnail\`, \`card\`, \`tablet\`, \`social\`, \`poster\`).
- \`GET /api/images/:id/base64/:variant\`: Returns JSON with base64 Data URL for image variants.
- \`DELETE /api/images/:id?token=<deleteToken>\`: Public deletion endpoint with delete token.
`;
}

llmsRoute.get('/llms.txt', (c) => {
  const content = generateLlmsTxt(config.publicBaseUrl);
  return c.text(content, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

llmsRoute.get('/llms-full.txt', (c) => {
  const content = generateLlmsFullTxt(config.publicBaseUrl);
  return c.text(content, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

export default llmsRoute;
