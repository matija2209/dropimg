#!/bin/bash
set -e

source .garage_secrets

GARAGE_BIN="docker exec garage /garage"

echo "Waiting for Garage to be ready..."
until $GARAGE_BIN status | grep -q "HEALTHY NODES"; do
  echo "Waiting..."
  sleep 2
done

NODE_ID=$($GARAGE_BIN status | grep -A 2 "HEALTHY NODES" | tail -n 1 | awk '{print $1}')
echo "Detected Node ID: $NODE_ID"

echo "Assigning layout..."
$GARAGE_BIN layout assign -z dc1 -c 10G "$NODE_ID" || echo "Layout already assigned"
# Get next version
CURRENT_VERSION=$($GARAGE_BIN layout show | grep "Version" | awk '{print $2}' || echo "0")
NEXT_VERSION=$((CURRENT_VERSION + 1))
$GARAGE_BIN layout apply --version "$NEXT_VERSION" || echo "Layout already applied"

echo "Creating bucket 'dropimg'..."
$GARAGE_BIN bucket create dropimg || true

echo "Creating key 'dropimg-app'..."
KEY_INFO=$($GARAGE_BIN key create dropimg-app)
ACCESS_KEY=$(echo "$KEY_INFO" | grep "Key ID:" | awk '{print $3}')
SECRET_KEY=$(echo "$KEY_INFO" | grep "Secret key:" | awk '{print $3}')

echo "Allowing key on bucket..."
$GARAGE_BIN bucket allow --read --write --owner dropimg --key dropimg-app

echo "--------------------------------------"
echo "Garage Setup Complete!"
echo "Bucket: dropimg"
echo "Access Key: $ACCESS_KEY"
echo "Secret Key: $SECRET_KEY"
echo "Endpoint: http://localhost:3900"
echo "Region: garage"
echo "--------------------------------------"

# Store secrets
echo "S3_ACCESS_KEY_ID=$ACCESS_KEY" >> .garage_secrets
echo "S3_SECRET_ACCESS_KEY=$SECRET_KEY" >> .garage_secrets
