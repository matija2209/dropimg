#!/bin/bash
set -e

# ==============================================================================
# DropImg Uninstallation Script
# ==============================================================================

# Default values
AUTO_YES=false
KEEP_DATA=false

# Simple flag parsing
for arg in "$@"; do
  case $arg in
    --yes|-y)
      AUTO_YES=true
      shift
      ;;
    --keep-data)
      KEEP_DATA=true
      shift
      ;;
  esac
done

if [ ! -f .env ]; then
    echo "❌ No .env file found. Is DropImg installed in this directory?"
    exit 1
fi

# Load variables from .env
source .env

echo "==============================================="
echo "🗑️  Uninstalling $APP_NAME ($COMPOSE_PROJECT_NAME)"
echo "==============================================="

# 1. Stop and remove containers and networks
echo "🛑 Stopping services..."
docker compose down

# 2. Data removal
if [ "$AUTO_YES" = true ]; then
    DELETE_DATA="y"
elif [ "$KEEP_DATA" = true ]; then
    DELETE_DATA="n"
else
    echo ""
    read -p "⚠️  Do you want to PERMANENTLY delete all uploaded images and database? (y/N): " DELETE_DATA
    DELETE_DATA=${DELETE_DATA:-n}
fi

if [[ "$DELETE_DATA" =~ ^[Yy]$ ]]; then
    echo "🧹 Removing data directories..."
    rm -rf data/
    rm -rf docker/garage/data/
    echo "✅ Data deleted."
else
    echo "💾 Data preserved in ./data and ./docker/garage/data"
fi

# 3. Config removal
if [ "$AUTO_YES" = true ]; then
    DELETE_CONFIG="y"
elif [ "$KEEP_DATA" = true ]; then
    DELETE_CONFIG="n"
else
    echo ""
    read -p "📝 Do you want to remove configuration files (.env, garage.toml)? (y/N): " DELETE_CONFIG
    DELETE_CONFIG=${DELETE_CONFIG:-n}
fi

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
