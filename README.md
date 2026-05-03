# DropImg

![DropImg](https://img.buildwithmatija.com/api/images/l2lqr2ap/file/original)


**DropImg** is a lightweight, clean, and Docker-first self-hosted image hosting application. Built for simplicity and speed, it allows you to drag, drop, or paste images to get instant public URLs for sharing.

It follows a modern "single app" architecture, combining a React frontend with a Hono backend, backed by SQLite for metadata and S3-compatible storage (Garage) for files.

## 🚀 Quick Start

DropImg is designed to be deployed with **zero local dependencies**. You do NOT need Node.js, npm, or a database installed on your VPS. Docker handles everything.

### Prerequisites
- A Linux VPS (Ubuntu/Debian recommended)
- `git` and `curl` installed

### One-Click Installation
```bash
git clone https://github.com/yourusername/dropimg.git
cd dropimg
./install.sh
```

### What the script does:
1. **Docker Check:** Automatically installs Docker and Docker Compose if they aren't found.
2. **Interactive Configuration:** Prompts you for:
   - **App Name:** Custom branding for your instance.
   - **Port:** Choose which port to expose (default `12312`).
   - **Public URL:** Automatically detects your VPS Public IP to suggest a default (e.g., `http://1.2.3.4:12312`).
   - **Admin Token:** Secure token for administrative actions (can be auto-generated).
   - **Cloudflare Tunnel:** Optional setup for exposing your instance securely via Cloudflare.
3. **Storage Provisioning:** Initializes **Garage S3**, creates the `dropimg` bucket, and generates access keys.
4. **Environment Setup:** Creates a `.env` file with all your settings.
5. **Launch:** Starts all containers in the background.

Once finished, your app will be live at the URL you configured!

### Uninstallation
To remove the application and stop all services:
```bash
./uninstall.sh
```
The script will ask if you want to preserve or delete your uploaded images and configuration.

---

## ✨ Features

- **Modern Stack:** Node 24 (LTS), Vite 8, React 19, Hono, and Tailwind CSS 4.
- **Clean UI:** Full-width responsive layout with Dark Mode support.
- **Instant Upload:** Support for Drag & Drop and Clipboard Paste.
- **Built-in Image Tools:** Compress uploaded JPG files or convert PNG to JPG directly from the uploader.
- **S3-Compatible Storage:** Built-in integration with [Garage](https://garagehq.deuxfleurs.fr/), a lightweight distributed object store.
- **SQLite + Drizzle:** Zero-config metadata storage with automatic migrations on startup.
- **Proxied Serving:** Images are served through the API (`/raw/:id`), allowing for private S3 buckets and clean URLs.
- **Copy-to-Clipboard:** Instant generation of Direct URLs and Markdown snippets.
- **Delete Links:** Secret tokens generated for every upload to allow user-driven deletion.

---

## 🖼️ Upload Modes

DropImg supports 3 uploader modes from the main upload screen:

- **Upload:** Host the original file as-is. Supports PNG, JPG, WEBP, and GIF.
- **Compress JPG:** Re-encode uploaded JPG files with `sharp` to reduce file size while keeping JPG output.
- **PNG to JPG:** Convert uploaded PNG files to JPG with transparency flattened onto a white background.

Notes:
- The processed output becomes the primary hosted asset.
- `Compress JPG` accepts `image/jpeg` only.
- `PNG to JPG` accepts `image/png` only.
- If JPG recompression would produce a larger file, DropImg keeps the original JPG instead of replacing it.
- Existing responsive variants are generated from the final hosted asset.

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
| `APP_NAME` | Name of the application (API) | `DropImg` |
| `VITE_APP_NAME` | Name shown in the UI | `DropImg` |
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
  - Target: `http://dropimg:3000`
  - Config: `cloudflared-config.yaml`
- **Nginx/Reverse Proxy:** Ensure `client_max_body_size` is set to match your `MAX_UPLOAD_MB`.
- **Persistence:** All data is stored in the `./data` directory. Back up this directory to preserve your images and database.

---

## Troubleshooting Playbook

### Cloudflare `Error 1033`

If the public hostname shows Cloudflare `Error 1033`, Cloudflare cannot currently find a healthy `cloudflared` connector for the tunnel.

For this project, a brief `1033` right after `docker compose up -d` can be normal while `cloudflared` is still registering its edge connections.

Check these items in order:

1. **Confirm the app is up locally**
   ```bash
   curl -I http://localhost:12312
   ```

2. **Check container status**
   ```bash
   docker compose ps
   ```

3. **Check tunnel logs**
   ```bash
   docker logs --tail 200 dropimg-tunnel
   ```

4. **Wait for healthy tunnel registration**
   You want to see log lines like:
   - `Registered tunnel connection ... connIndex=0`
   - `Registered tunnel connection ... connIndex=1`
   - `Registered tunnel connection ... connIndex=2`
   - `Registered tunnel connection ... connIndex=3`

5. **Verify the tunnel origin target**
   In this repo, `cloudflared-config.yaml` should point to:
   ```yaml
   ingress:
     - hostname: img.buildwithmatija.com
       service: http://dropimg:3000
   ```

6. **Recreate only the tunnel container if needed**
   ```bash
   docker compose up -d tunnel
   ```

## 📄 License
MIT
