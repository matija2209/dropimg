# DropImg upload reference

## Paths

| Asset | Route | Handler |
|-------|-------|---------|
| Images | `POST /api/upload` | Hono + Sharp |
| Service images | `POST /api/service/image-upload` | Bearer auth + caller-defined S3 key |
| Videos | `/api/upload/chunked/*` | Go uploader → `POST /api/internal/media-finalized` |

Videos are rejected on the direct upload route. Image modes (compress, strip metadata, etc.) remain image-only.

## Service image upload

Trusted callers (e.g. build-with-matija MCP) can upload image bytes to a caller-defined storage key.

**`POST /api/service/image-upload`**

Auth: `Authorization: Bearer ${INTERNAL_UPLOAD_SECRET}`

Body (JSON):

| Field | Required | Notes |
|-------|----------|-------|
| `storageKey` | yes | S3 object key, e.g. `blog/my-slug/01-hero-a82f.webp` |
| `mimeType` | yes | `image/webp`, `image/png`, `image/jpeg`, or `image/gif` |
| `imageBase64` | yes | Raw image bytes |
| `alt` | no | Stored as alt text metadata |
| `force` | no | Overwrite existing object (default: idempotent skip) |

Response:

```json
{
  "ok": true,
  "storageKey": "blog/my-slug/01-hero-a82f.webp",
  "rawUrl": "https://img.buildwithmatija.com/raw/blog/my-slug/01-hero-a82f.webp",
  "uploaded": true,
  "width": 1536,
  "height": 1024,
  "variants": {
    "tablet": { "storageKey": "...", "url": "..." }
  }
}
```

Variant keys are stored as siblings: `blog/my-slug/01-hero-a82f.tablet.webp`, etc.

This route is publicly reachable but bearer-protected. It does not accept markdown or article content — image assets only.

## Chunked protocol

- `POST /api/upload/chunked/init` — `{ sessionId?, fileName, mimeType, fileSize }`
- `GET /api/upload/chunked/:sessionId` — resume offset
- `PUT /api/upload/chunked/:sessionId` — raw body, header `x-upload-offset`
- `DELETE /api/upload/chunked/:sessionId` — abort
- `POST /api/upload/chunked/complete` — `{ sessionId, altName?, transcode? }`

Chunk size: 8 MiB (see `CHUNK_SIZE_BYTES`). Staging key: `chunked-staging/videos/<sessionId>/<fileName>`.

## Production routing

**VPS (`img.buildwithmatija.com`):** `~/proxy-server` :443 → host `:12312` → **dropimg-nginx** (splits internally):

- `/api/upload/chunked/` → `uploader:8080`
- `/api/internal/media-finalized` → block publicly (404)
- everything else → `dropimg:3000`

Prefer this over Cloudflare Tunnel for large video uploads.

## Environment

| Variable | Purpose |
|----------|---------|
| `MAX_VIDEO_UPLOAD_MB` | Chunked video cap (set at `install.sh` prompt) |
| `VIDEO_TRANSCODE_ENABLED` | Allow H.264 MP4 optimize pipeline |
| `INTERNAL_UPLOAD_SECRET` | uploader → API callback auth; also used by `POST /api/service/image-upload` |
| `API_INTERNAL_URL` | uploader callback target |
| `STORAGE_DRIVER` | Must be `s3` for chunked video |

## FFmpeg optimize

When enabled, finalize runs the TV-ready H.264/AAC MP4 pipeline (max 1280×720, `yuv420p`, `+faststart`) and asserts output with ffprobe before storage.
