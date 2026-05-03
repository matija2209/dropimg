#!/bin/bash
set -e

# ==============================================================================
# DropImg Uninstallation Script
# ==============================================================================

if [ ! -f .env ]; then
    echo "❌ No .env file found. Is DropImg installed in this directory?"
    exit 1
fi

# Load variables from .env
source .env

echo "==============================================="
echo "🗑️  Uninstalling $APP_NAME ($COMPOSE_PROJECT_NAME)"
echo "==============================================="

# 1. Stop and remove containers, networks, and internal volumes
echo "🛑 Stopping services..."
docker compose down -v

# 2. Ask about data removal
echo ""
read -p "⚠️  Do you want to PERMANENTLY delete all uploaded images and database? (y/N): " DELETE_DATA
DELETE_DATA=${DELETE_DATA:-n}

if [[ "$DELETE_DATA" =~ ^[Yy]$ ]]; then
    echo "🧹 Removing data directories..."
    rm -rf data/
    rm -rf docker/garage/data/
    echo "✅ Data deleted."
else
    echo "💾 Data preserved in ./data and ./docker/garage/data"
fi

# 3. Ask about config removal
echo ""
read -p "📝 Do you want to remove configuration files (.env, garage.toml)? (y/N): " DELETE_CONFIG
DELETE_CONFIG=${DELETE_CONFIG:-n}

if [[ "$DELETE_CONFIG" =~ ^[Yy]$ ]]; then
    echo "🧹 Removing configuration..."
    rm -f .env
    rm -f .garage_secrets
    rm -f docker/garage/config/garage.toml
    echo "✅ Configuration removed."
fi

echo ""
echo "==============================================="
echo "✅ Uninstallation complete."
echo "==============================================="
