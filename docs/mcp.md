# DropImg Model Context Protocol (MCP) Server

DropImg includes a built-in **Model Context Protocol (MCP)** server built with `@modelcontextprotocol/server` and `@modelcontextprotocol/hono`.

This allows external AI agents and IDEs (Claude Desktop, Cursor, Antigravity IDE, Zed, Windsurf) to directly **upload**, **retrieve**, **list**, and **delete** hosted images, and receive Markdown embed codes, responsive `<picture>` markup, and base64 image data for multimodal vision.

---

## Capabilities

### 1. Tools

| Tool | Description | Inputs |
| :--- | :--- | :--- |
| `upload_image` | Upload and host an image on DropImg | `imageData` (base64) OR `imageUrl` (web link), `altName`, `mode` (`upload`, `compress-jpg`, `png-to-jpg`, `strip-metadata`, `remove-background`), `quality` (1-100) |
| `get_image` | Retrieve metadata, direct URLs, variants, and optional base64 image content | `id`, `variant` (`original`, `thumbnail`, `card`, `tablet`, `social`), `includeImageData` (boolean) |
| `list_images` | List recent images with pagination | `limit` (default 20, max 100), `offset` (default 0) |
| `delete_image` | Delete an image and its variants | `id`, `deleteToken` (optional if admin authenticated) |

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
Remote HTTP requests are protected by Bearer token authentication unless `PUBLIC_MODE=true` is set.
Provide your token via the `Authorization` header:
```http
Authorization: Bearer <MCP_API_KEY or ADMIN_TOKEN or INTERNAL_UPLOAD_SECRET>
```
Or as a URL query parameter:
```
https://img.yourdomain.com/api/mcp?token=<TOKEN>
```

#### Environment Variables
In your `.env` or `docker-compose.yml`:
- `MCP_API_KEY`: Dedicated secret key for external MCP clients.
- `ADMIN_TOKEN`: Also accepted as administrative master token.
- `INTERNAL_UPLOAD_SECRET`: Also accepted for internal microservice uploads.
