#!/usr/bin/env bash
# Migrate DropImg from Cloudflare Tunnel → ~/proxy-server (whcp-dev-proxy).
# Prereqs: Cloudflare DNS-only A record img → VPS public IP (e.g. 95.217.200.105).
set -euo pipefail

DROPIMG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_DIR="${PROXY_DIR:-$HOME/proxy-server}"
DOMAIN="${DROPIMG_DOMAIN:-img.buildwithmatija.com}"
APP_PORT="${APP_PORT:-12312}"
CERTBOT_WEBROOT="${CERTBOT_WEBROOT:-$HOME/marta-80-tls/certbot/www}"
LE_LIVE="/etc/letsencrypt/live/${DOMAIN}"

echo "==============================================="
echo "DropImg: migrate off Cloudflare Tunnel"
echo "  DropImg:  ${DROPIMG_DIR}"
echo "  Proxy:    ${PROXY_DIR}"
echo "  Domain:   ${DOMAIN}"
echo "  App port: ${APP_PORT}"
echo "==============================================="

if [[ ! -d "${PROXY_DIR}" ]]; then
  echo "Error: proxy-server not found at ${PROXY_DIR}"
  exit 1
fi

if [[ ! -f "${PROXY_DIR}/nginx.d/img.buildwithmatija.com.conf" ]]; then
  echo "Error: missing ${PROXY_DIR}/nginx.d/img.buildwithmatija.com.conf"
  echo "Pull latest dropimg + proxy-server configs first."
  exit 1
fi

# --- 1. Stop Cloudflare Tunnel ---
echo ""
echo "1. Stopping Cloudflare Tunnel (if running)..."
cd "${DROPIMG_DIR}"
docker compose --profile tunnel stop tunnel 2>/dev/null || true
docker compose --profile tunnel rm -f tunnel 2>/dev/null || true

# --- 2. Ensure .env secrets ---
echo ""
echo "2. Checking DropImg .env..."
ENV_FILE="${DROPIMG_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "   Warning: no .env — copy from .env.example and configure S3 keys."
else
  if ! grep -q '^INTERNAL_UPLOAD_SECRET=.\+' "${ENV_FILE}" 2>/dev/null; then
    SECRET=$(openssl rand -hex 32)
    echo "INTERNAL_UPLOAD_SECRET=${SECRET}" >> "${ENV_FILE}"
    echo "   Added INTERNAL_UPLOAD_SECRET to .env"
  fi
  if ! grep -q '^VIDEO_UPLOADS_ENABLED=' "${ENV_FILE}" 2>/dev/null; then
    echo "VIDEO_UPLOADS_ENABLED=true" >> "${ENV_FILE}"
  fi
  if ! grep -q '^STORAGE_DRIVER=' "${ENV_FILE}" 2>/dev/null; then
    echo "STORAGE_DRIVER=s3" >> "${ENV_FILE}"
  fi
fi

# --- 3. TLS ---
echo ""
echo "3. TLS certificate for ${DOMAIN}..."
CERT_DIR="${PROXY_DIR}/certs/img.buildwithmatija.com"
if [[ -f "${LE_LIVE}/fullchain.pem" ]]; then
  echo "   Let's Encrypt cert found — switching nginx to LE paths..."
  bash "${PROXY_DIR}/scripts/switch-img-nginx-to-letsencrypt.sh" || true
elif [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
  echo "   Using existing bootstrap cert in ${CERT_DIR}"
else
  echo "   Creating bootstrap self-signed cert (replace with LE when ready)..."
  bash "${PROXY_DIR}/scripts/setup-img-buildwithmatija-tls-selfsigned.sh" "${DOMAIN}"
  echo ""
  echo "   For trusted HTTPS (no browser warning), run as root on this host:"
  echo "     sudo ${PROXY_DIR}/scripts/setup-img-buildwithmatija-tls-le.sh"
  echo "     ${PROXY_DIR}/scripts/switch-img-nginx-to-letsencrypt.sh"
fi

# --- 4. Start DropImg stack (nginx on APP_PORT) ---
echo ""
echo "4. Starting DropImg (garage + API + uploader + nginx on :${APP_PORT})..."
cd "${DROPIMG_DIR}"
docker compose build dropimg uploader 2>/dev/null || docker compose build
docker compose up -d

echo "   Waiting for dropimg-nginx..."
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    echo "   dropimg-nginx is up."
    break
  fi
  sleep 2
done

# --- 5. Reload VPS proxy ---
echo ""
echo "5. Reloading whcp-dev-proxy..."
cd "${PROXY_DIR}"
docker compose up -d --force-recreate dev-proxy

sleep 2

# --- 6. Verify ---
echo ""
echo "6. Verification..."
HTTP_LOCAL=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${APP_PORT}/" || echo "000")
HTTP_HTTPS=$(curl -sS -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" || echo "000")
CHUNK_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "https://${DOMAIN}/api/upload/chunked/init" \
  -H 'content-type: application/json' \
  -d '{"fileName":"probe.mp4","mimeType":"video/mp4","fileSize":1}' || echo "000")

echo "   http://127.0.0.1:${APP_PORT}/     → ${HTTP_LOCAL}"
echo "   https://${DOMAIN}/               → ${HTTP_HTTPS}"
echo "   POST .../chunked/init            → ${CHUNK_CODE} (expect not 404)"

echo ""
echo "==============================================="
echo "Done."
echo "  Site: https://${DOMAIN}"
echo "  Tunnel is stopped; traffic should use DNS → VPS :443 → :${APP_PORT}"
echo ""
echo "Cloudflare: DNS only (grey cloud) A record → this server's public IP."
echo "Renew certs: sudo certbot renew"
echo "==============================================="
