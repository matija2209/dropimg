# DropImg

**DropImg** is a lightweight, clean, and Docker-first self-hosted image hosting application. Built for simplicity and speed, it allows you to drag, drop, or paste images to get instant public URLs for sharing.

It follows a modern "single app" architecture, combining a React frontend with a Hono backend, backed by SQLite for metadata and S3-compatible storage (Garage) for files.

## 🚀 Quick Start

The fastest way to get started is using Docker Compose. Follow these **3 steps** exactly:

1. **Initialize Garage Config:**
   Generates unique secrets for your S3 storage.
   ```bash
   ./scripts/init-garage-config.sh
   ```

2. **Start the Stack:**
   Builds the Node 24 image and starts the services.
   ```bash
   docker compose up -d
   ```

3. **Setup S3 Resources:**
   Configures the Garage layout, creates the bucket, and generates access keys.
   ```bash
   ./scripts/setup-garage-resources.sh
   ```

Access the UI at: **`http://localhost:12312`**

---

## ✨ Features

- **Modern Stack:** Node 24 (LTS), Vite 8, React, Hono, and Tailwind CSS.
- **Instant Upload:** Support for Drag & Drop and Clipboard Paste.
- **S3-Compatible Storage:** Built-in integration with [Garage](https://garagehq.deuxfleurs.fr/), a lightweight distributed object store.
- **SQLite + Drizzle:** Zero-config metadata storage with automatic migrations on startup.
- **Proxied Serving:** Images are served through the API (`/raw/:id`), allowing for private S3 buckets and clean URLs.
- **Copy-to-Clipboard:** Instant generation of Direct URLs and Markdown snippets.
- **Delete Links:** Secret tokens generated for every upload to allow user-driven deletion.

---

## 🏗️ Architecture

```text
Browser -> [ React / Vite Frontend ]
                |
                v
        [ Hono API / Node.js ]
                |
        +-------+-------+
        |               |
[ SQLite DB ]    [ Garage S3 / Local Disk ]
(Metadata)       (Object Storage)
```

---

## ⚙️ Configuration

Environment variables can be managed in `docker-compose.yml` or a `.env` file.

### General Settings
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Internal API port | `3000` |
| `APP_URL` | Full URL of the application | `http://localhost:12312` |
| `STORAGE_DRIVER` | `local` or `s3` | `s3` |
| `MAX_UPLOAD_MB` | Max file size in megabytes | `20` |
| `ADMIN_TOKEN` | Token for administrative tasks | `change-me` |

### S3 / Garage Settings
| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT` | The S3 API endpoint (e.g., `http://garage:3900`) |
| `S3_BUCKET` | The bucket name (e.g., `dropimg`) |
| `S3_REGION` | The S3 region (e.g., `garage`) |
| `S3_ACCESS_KEY_ID` | Your S3 Access Key |
| `S3_SECRET_ACCESS_KEY` | Your S3 Secret Key |
| `S3_FORCE_PATH_STYLE` | Set to `true` for Garage/MinIO |

---

## 🛠️ Development

### Prerequisites
- Node 24+
- Docker (for Garage)

### Local Setup
1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run Backend:**
   ```bash
   cd apps/api
   npm run dev
   ```

3. **Run Frontend:**
   ```bash
   cd apps/web
   npm run dev
   ```

4. **Database Migrations:**
   Migrations run automatically on API startup. You can manually push schema changes using:
   ```bash
   cd apps/api
   npm run db:push
   ```

---

## ☁️ Cloudflare Tunnel Setup (CLI)

If you want to expose your local instance to a custom domain using `cloudflared`:

1. **Login to Cloudflare:**
   ```bash
   cloudflared tunnel login
   ```

2. **Create a new tunnel:**
   ```bash
   cloudflared tunnel create dropimg
   ```

3. **Route your domain:**
   ```bash
   cloudflared tunnel route dns dropimg your.domain.com
   ```

4. **Configure the project:**
   Update `cloudflared-config.yaml` with your `tunnel` ID and the path to your `credentials-file` (usually in `~/.cloudflared/<ID>.json`).

5. **Start the stack:**
   The `tunnel` service in `docker-compose.yml` will handle the connection automatically.

---

## 📦 Deployment Notes

- **Cloudflare Tunnel:** The project includes a `tunnel` service in `docker-compose.yml`. 
  - Hostname: `img.buildwithmatija.com`
  - Target: `http://localhost:12312`
  - Config: `cloudflared-config.yaml`
- **Nginx/Reverse Proxy:** Ensure `client_max_body_size` is set to match your `MAX_UPLOAD_MB`.
- **Persistence:** All data is stored in the `./data` directory. Back up this directory to preserve your images and database.

## 📄 License
MIT
