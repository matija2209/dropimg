#!/bin/bash
set -e

# Generate secrets if they don't exist
GARAGE_RPC_SECRET=$(openssl rand -hex 32)
GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)

echo "Generating Garage config..."
sed "s/\${GARAGE_RPC_SECRET}/$GARAGE_RPC_SECRET/g; s/\${GARAGE_ADMIN_TOKEN}/$GARAGE_ADMIN_TOKEN/g" \
    docker/garage/config/garage.toml.template > docker/garage/config/garage.toml

echo "Garage configuration generated."
echo "Admin Token: $GARAGE_ADMIN_TOKEN"

# Store for later use in setup script
echo "GARAGE_ADMIN_TOKEN=$GARAGE_ADMIN_TOKEN" > .garage_secrets
chmod 600 .garage_secrets
