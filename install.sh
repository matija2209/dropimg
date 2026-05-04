#!/bin/bash
set -e

# ==============================================================================
# DropImg One-Click VPS Deployment Script
# ==============================================================================

echo "==============================================="
echo "🚀 Starting DropImg One-Click Deployment"
echo "==============================================="

# Function to find the next available port
find_available_port() {
    local port=$1
    while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo $port
}

# 1. Install Docker and ExifTool if missing
if ! command -v docker &> /dev/null; then
    echo "🐳 Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo "✅ Docker installed."
else
    echo "✅ Docker is already installed."
fi

if ! command -v exiftool &> /dev/null; then
    echo "📸 ExifTool not found. Installing ExifTool..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y libimage-exiftool-perl
    elif command -v yum &> /dev/null; then
        sudo yum install -y perl-Image-ExifTool
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y perl-Image-ExifTool
    else
        echo "⚠️  Could not detect package manager. Please install ExifTool manually if needed."
    fi
    echo "✅ ExifTool installed."
else
    echo "✅ ExifTool is already installed."
fi

# 2. Gather Configuration
echo ""
echo "⚙️  Basic Configuration Setup"

# Try to get Public IPv4 (preferring IPv4)
PUBLIC_IP=$(curl -s -4 --max-time 2 https://ifconfig.me || curl -s -4 --max-time 2 https://api.ipify.org || echo "localhost")

read -p "Enter the App Name [DropImg]: " APP_NAME
APP_NAME=${APP_NAME:-DropImg}
APP_SLUG=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')

SUGGESTED_APP_PORT=$(find_available_port 12312)
read -p "Enter the port to expose the app on [$SUGGESTED_APP_PORT]: " APP_PORT
APP_PORT=${APP_PORT:-$SUGGESTED_APP_PORT}

DEFAULT_URL="http://$PUBLIC_IP:$APP_PORT"
read -p "Enter your public domain/URL [$DEFAULT_URL]: " APP_URL
APP_URL=${APP_URL:-$DEFAULT_URL}

read -p "Enter a secure Admin Token (for deleting images) [press Enter to generate]: " ADMIN_TOKEN
if [ -z "$ADMIN_TOKEN" ]; then
    ADMIN_TOKEN=$(openssl rand -hex 16)
    echo "   Generated Admin Token: $ADMIN_TOKEN"
fi

# Auth Configuration
echo ""
echo "🔐 Authentication Setup"
read -p "Do you want to enable User Authentication and Admin Access? (Y/n): " ENABLE_AUTH
ENABLE_AUTH=${ENABLE_AUTH:-y}

if [[ "$ENABLE_AUTH" =~ ^[Yy]$ ]]; then
    PUBLIC_MODE=false
    BETTER_AUTH_SECRET=$(openssl rand -base64 32)
    BETTER_AUTH_URL=$APP_URL
    echo "   Better Auth Secret generated."
else
    PUBLIC_MODE=true
    BETTER_AUTH_SECRET=""
    BETTER_AUTH_URL=""
fi

# Storage Port Configuration
echo ""
echo "📦 Storage Port Configuration (External mappings)"
SUGGESTED_S3_PORT=$(find_available_port 3900)
read -p "External S3 Port [$SUGGESTED_S3_PORT]: " GARAGE_S3_PORT
GARAGE_S3_PORT=${GARAGE_S3_PORT:-$SUGGESTED_S3_PORT}

SUGGESTED_ADMIN_PORT=$(find_available_port 3903)
read -p "External Garage Admin Port [$SUGGESTED_ADMIN_PORT]: " GARAGE_RPC_PORT
GARAGE_RPC_PORT=${GARAGE_RPC_PORT:-$SUGGESTED_ADMIN_PORT}

# Cloudflare Tunnel Option
echo ""
read -p "Do you want to enable Cloudflare Tunnel? (y/N): " ENABLE_TUNNEL
ENABLE_TUNNEL=${ENABLE_TUNNEL:-n}

# 3. Setup Garage (S3 Backend) Config
echo ""
echo "🔧 Initializing Garage Storage Configuration..."
mkdir -p docker/garage/config
mkdir -p docker/garage/data/meta
mkdir -p docker/garage/data/data

GARAGE_RPC_SECRET=$(openssl rand -hex 32)
GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)

sed "s/\${GARAGE_RPC_SECRET}/$GARAGE_RPC_SECRET/g; s/\${GARAGE_ADMIN_TOKEN}/$GARAGE_ADMIN_TOKEN/g" \
    docker/garage/config/garage.toml.template > docker/garage/config/garage.toml

# 4. Generate Initial .env
echo ""
echo "📝 Writing environment variables to .env..."
cat <<EOF > .env
COMPOSE_PROJECT_NAME=$APP_SLUG
APP_NAME=$APP_NAME
APP_PORT=$APP_PORT
APP_URL=$APP_URL
VITE_API_URL=$APP_URL
ADMIN_TOKEN=$ADMIN_TOKEN
PUBLIC_MODE=$PUBLIC_MODE
VITE_PUBLIC_MODE=$PUBLIC_MODE
EOF

if [[ "$ENABLE_AUTH" =~ ^[Yy]$ ]]; then
    cat <<EOF >> .env
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
BETTER_AUTH_URL=$BETTER_AUTH_URL
EOF
else
    cat <<EOF >> .env
# BETTER_AUTH_SECRET=
# BETTER_AUTH_URL=
EOF
fi

cat <<EOF >> .env
GARAGE_S3_PORT=$GARAGE_S3_PORT
GARAGE_RPC_PORT=$GARAGE_RPC_PORT
EOF

# Update cloudflared-config.yaml hostname if needed
DOMAIN_ONLY=$(echo "$APP_URL" | sed -E 's|^.*://||; s|/.*$||; s|\[?([^]]+)\]?(:.*)?|\1|')

if [ -f cloudflared-config.yaml ]; then
    echo "☁️  Syncing Cloudflare Tunnel hostname to: $DOMAIN_ONLY"
    sed -i "s/hostname: .*/hostname: $DOMAIN_ONLY/" cloudflared-config.yaml
fi

# 5. Start Services (Garage needs to be running to create bucket/keys)
echo ""
echo "🚀 Starting Garage storage engine..."
docker compose up -d garage

GARAGE_BIN="docker compose exec garage /garage"

echo "⏳ Waiting for Garage to initialize..."
until $GARAGE_BIN status | grep -q "HEALTHY NODES"; do
  sleep 2
done

NODE_ID=$($GARAGE_BIN status | grep -A 2 "HEALTHY NODES" | tail -n 1 | awk '{print $1}')

echo "🔧 Configuring Garage layout for Node ID: $NODE_ID"
$GARAGE_BIN layout assign -z dc1 -c 10G "$NODE_ID" || true
CURRENT_VERSION=$($GARAGE_BIN layout show | grep "Version" | awk '{print $2}' || echo "0")
NEXT_VERSION=$((CURRENT_VERSION + 1))
$GARAGE_BIN layout apply --version "$NEXT_VERSION" || true

echo "🪣 Creating 'dropimg' S3 bucket..."
$GARAGE_BIN bucket create dropimg || true

echo "🔑 Generating S3 credentials..."
KEY_INFO=$($GARAGE_BIN key create dropimg-app)
S3_ACCESS_KEY_ID=$(echo "$KEY_INFO" | grep "Key ID:" | awk '{print $3}')
S3_SECRET_ACCESS_KEY=$(echo "$KEY_INFO" | grep "Secret key:" | awk '{print $3}')

$GARAGE_BIN bucket allow --read --write --owner dropimg --key dropimg-app

# Append S3 keys to .env
cat <<EOF >> .env
S3_BUCKET=dropimg
S3_ENDPOINT=http://garage:3900
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
EOF

echo ""
echo "🚀 Starting application..."
if [[ "$ENABLE_TUNNEL" =~ ^[Yy]$ ]]; then
    echo "   (Including Cloudflare Tunnel)"
    docker compose --profile tunnel up -d
else
    docker compose up -d dropimg
fi

echo ""
echo "==============================================="
echo "✅ $APP_NAME is successfully deployed!"
echo "==============================================="
echo "📍 Application URL: $APP_URL"
echo "🔌 External Port:  $APP_PORT"
echo "📦 Garage S3 Port: $GARAGE_S3_PORT"
echo "🛡️  Admin Token:   $ADMIN_TOKEN"
echo ""
if [[ "$ENABLE_TUNNEL" =~ ^[Yy]$ ]]; then
    echo "☁️  Cloudflare Tunnel is enabled."
    echo "   Ensure your credentials.json and cloudflared-config.yaml are correctly set."
fi
echo ""
echo "To view logs: docker compose logs -f dropimg"
echo "To stop:      docker compose down"
echo "==============================================="
