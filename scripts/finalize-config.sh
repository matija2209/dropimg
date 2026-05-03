#!/bin/bash
set -e

# Load secrets from the setup script
if [ ! -f .garage_secrets ]; then
    echo "Error: .garage_secrets not found. Run ./scripts/setup-garage-resources.sh first."
    exit 1
fi
source .garage_secrets

# Prompt for hostname
DEFAULT_HOSTNAME="img.buildwithmatija.com"
read -p "Enter your domain (e.g., img.example.com) [$DEFAULT_HOSTNAME]: " DOMAIN
DOMAIN=${DOMAIN:-$DEFAULT_HOSTNAME}

echo "Updating docker-compose.yml..."
# Update S3 Keys
sed -i "s/S3_ACCESS_KEY_ID: \".*\"/S3_ACCESS_KEY_ID: \"$S3_ACCESS_KEY_ID\"/" docker-compose.yml
sed -i "s/S3_SECRET_ACCESS_KEY: \".*\"/S3_SECRET_ACCESS_KEY: \"$S3_SECRET_ACCESS_KEY\"/" docker-compose.yml

# Update URLs (using | as delimiter for sed because of the slashes in https://)
sed -i "s|https://img.buildwithmatija.com|https://$DOMAIN|g" docker-compose.yml

echo "Updating cloudflared-config.yaml..."
sed -i "s/hostname: .*/hostname: $DOMAIN/" cloudflared-config.yaml

echo "--------------------------------------"
echo "Configuration updated successfully!"
echo "Domain: https://$DOMAIN"
echo "--------------------------------------"
echo "You can now run: docker compose up -d"
