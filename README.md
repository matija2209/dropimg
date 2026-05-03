# DropImg

<div align="center">

![DropImg Header](https://img.buildwithmatija.com/api/images/l2lqr2ap/file/original)

**A lightweight, clean, and Docker-first self-hosted image hosting application.**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/matija2209/dropimg.svg)](https://github.com/matija2209/dropimg/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/matija2209/dropimg.svg)](https://github.com/matija2209/dropimg/issues)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2024-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-blue.svg)](https://www.docker.com/)

[Quick Start](#quick-start) • [Features](#features) • [Architecture](#architecture) • [Development](#development) • [Contributing](#contributing)

</div>

---

**DropImg** is built for simplicity and speed. It allows you to drag, drop, or paste images to get instant public URLs for sharing. It follows a modern "single app" architecture, combining a React frontend with a Hono backend, backed by SQLite for metadata and S3-compatible storage (Garage) for files.

## Quick Start

DropImg is designed to be deployed with **zero local dependencies**. You do NOT need Node.js, npm, or a database installed on your VPS. Docker handles everything.

### Prerequisites
- A Linux VPS (Ubuntu/Debian recommended)
- `git` and `curl` installed

### One-Click Installation
```bash
git clone https://github.com/matija2209/dropimg.git
cd dropimg
./install.sh
```

### What the script does:
1. **Docker Check:** Automatically installs Docker and Docker Compose if they aren't found.
2. **Interactive Configuration:** Prompts you for App Name, Port, Public URL, Admin Token, and optional Cloudflare Tunnel.
3. **Storage Provisioning:** Initializes **Garage S3**, creates the `dropimg` bucket, and generates access keys.
4. **Environment Setup:** Creates a `.env` file with all your settings.
5. **Launch:** Starts all containers in the background.

Once finished, your app will be live at the URL you configured!

### Uninstallation
To remove the application and stop all services:
```bash
./uninstall.sh
```

**CLI Options:**
- `./uninstall.sh --yes`: Non-interactive, deletes **everything** (containers, data, and config).
- `./uninstall.sh --keep-data`: Non-interactive, stops services but **preserves** all files.

---

## Features

- **Instant Upload:** Support for Drag & Drop and Clipboard Paste.
- **Built-in Image Tools:** Compress JPGs or convert PNGs to JPG directly from the uploader.
- **Modern Stack:** React 19, Vite 8, Hono, and Tailwind CSS 4.
- **Clean UI:** Full-width responsive layout with Dark Mode support.
- **S3-Compatible Storage:** Built-in integration with [Garage](https://garagehq.deuxfleurs.fr/).
- **SQLite + Drizzle:** Zero-config metadata storage with automatic migrations.
- **Proxied Serving:** Clean URLs (`/raw/:id`) and private S3 bucket support.
- **Copy-to-Clipboard:** Direct URLs and Markdown snippets generated instantly.
- **Delete Links:** Secret tokens for user-driven deletion.

---

## S3 Ecosystem Integration

DropImg is built from the ground up to be **S3-native**. Because it uses the standard S3 protocol, it can seamlessly integrate into your existing workflow or share storage with other applications:

- **Shared Storage:** You can point DropImg to the same bucket used by other S3-aware systems. For example, it works perfectly alongside **Payload CMS** using the [`@payloadcms/storage-s3`](https://www.npmjs.com/package/@payloadcms/storage-s3) adapter.
- **Provider Agnostic:** Use any S3-compatible provider including AWS S3, Cloudflare R2, Backblaze B2, Minio, or the built-in Garage S3.
- **Standard Tooling:** Manage your assets directly using industry-standard tools like `aws-cli`, `rclone`, or Cyberduck.

### **Example: Connecting Payload CMS**
Because DropImg and Payload use the same S3 environment variables, integration is a breeze:

```typescript
import { s3Storage } from '@payloadcms/storage-s3'

export default buildConfig({
  plugins: [
    s3Storage({
      collections: {
        'media': true,
      },
      bucket: process.env.S3_BUCKET,
      config: {
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
        region: process.env.S3_REGION,
        forcePathStyle: true,
      },
    }),
  ],
})
```

---

## Tech Stack

<details>
<summary>Click to expand</summary>

| Category | Technology |
|----------|------------|
| **Frontend** | ![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB) ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white) ![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white) |
| **Backend** | ![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white) ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white) |
| **Database** | ![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat-square&logo=sqlite&logoColor=white) ![Drizzle](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black) |
| **Storage** | ![Garage](https://img.shields.io/badge/Garage_S3-FF9900?style=flat-square&logo=amazons3&logoColor=white) |
| **DevOps** | ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white) ![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=flat-square&logo=cloudflare&logoColor=white) |

</details>

---

## Architecture

```mermaid
graph TD
    User([User]) -->|Browser| Web[React / Vite Frontend]
    Web -->|API Requests| API[Hono API / Node.js]
    API -->|Metadata| DB[(SQLite DB)]
    API -->|Object Storage| S3[(Garage S3 / Local Disk)]
```

---

## Project Structure

```text
.
├── apps/
│   ├── api/          # Hono Backend (TypeScript)
│   └── web/          # React Frontend (Vite + Tailwind 4)
├── docker/
│   └── garage/       # Garage S3 configuration & templates
├── scripts/          # Helper scripts for installation and config
├── install.sh        # Main installation script
├── uninstall.sh      # Uninstallation script
└── docker-compose.yml # Orchestrates API, Web, and Garage
```

---

## Configuration

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

---

## Development

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

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security vulnerabilities, please refer to our [Security Policy](SECURITY.md).

## License

This project is licensed under the [MIT License](LICENSE).
