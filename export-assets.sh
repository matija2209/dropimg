#!/bin/bash
set -e

# ==============================================================================
# DropImg Asset Export Script
# ==============================================================================

if [ ! -f .env ]; then
    echo "❌ No .env file found. Is DropImg installed?"
    exit 1
fi

source .env

EXPORT_DIR="./export"
mkdir -p "$EXPORT_DIR"

echo "==============================================="
echo "📦 Exporting assets from $S3_BUCKET..."
echo "==============================================="

# We use a temporary container to perform the sync
# This ensures the user doesn't need to install aws-cli on their host
docker run --rm \
    --network "${COMPOSE_PROJECT_NAME}_default" \
    -v "$(pwd)/export:/export" \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
    -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
    -e AWS_DEFAULT_REGION="garage" \
    amazon/aws-cli \
    --endpoint-url "$S3_ENDPOINT" \
    s3 sync "s3://$S3_BUCKET" /export

echo ""
echo "==============================================="
echo "✅ Export complete!"
echo "📍 Files are located in: $EXPORT_DIR"
echo "==============================================="
