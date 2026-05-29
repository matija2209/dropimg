# DropImg upload reference

## Paths

| Asset | Route | Handler |
|-------|-------|---------|
| Images | `POST /api/upload` | Hono + Sharp |
| Videos | `/api/upload/chunked/*` | Go uploader → `POST /api/internal/media-finalized` |

Videos are rejected on the direct upload route. Image modes (compress, strip metadata, etc.) remain image-only.

## Chunked protocol

- `POST /api/upload/chunked/init` — `{ sessionId?, fileName, mimeType, fileSize }`
- `GET /api/upload/chunked/:sessionId` — resume offset
- `PUT /api/upload/chunked/:sessionId` — raw body, header `x-upload-offset`
- `DELETE /api/upload/chunked/:sessionId` — abort
- `POST /api/upload/chunked/complete` — `{ sessionId, altName?, transcode? }`

Chunk size: 8 MiB (see `CHUNK_SIZE_BYTES`). Staging key: `chunked-staging/videos/<sessionId>/<fileName>`.

## Production routing

Use the `nginx` compose profile or an external reverse proxy:

- `/api/upload/chunked/` → `uploader:8080`
- `/api/internal/media-finalized` → block publicly (404)
- everything else → `dropimg:3000`

## Environment

| Variable | Purpose |
|----------|---------|
| `MAX_VIDEO_UPLOAD_MB` | Chunked video cap (set at `install.sh` prompt) |
| `VIDEO_TRANSCODE_ENABLED` | Allow H.264 MP4 optimize pipeline |
| `INTERNAL_UPLOAD_SECRET` | uploader → API callback auth |
| `API_INTERNAL_URL` | uploader callback target |
| `STORAGE_DRIVER` | Must be `s3` for chunked video |

## FFmpeg optimize

When enabled, finalize runs the TV-ready H.264/AAC MP4 pipeline (max 1280×720, `yuv420p`, `+faststart`) and asserts output with ffprobe before storage.
