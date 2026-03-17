#!/usr/bin/env bash
#
# Upload extension to Chrome Web Store using chrome-webstore-upload-cli.
#
# Prerequisites:
#   npm install -g chrome-webstore-upload-cli
#
# Required environment variables (set these as GitHub Secrets or export locally):
#   EXTENSION_ID   - Your Chrome Web Store extension ID
#   CLIENT_ID      - Google Cloud OAuth2 Client ID
#   CLIENT_SECRET  - Google Cloud OAuth2 Client Secret
#   REFRESH_TOKEN  - Google Cloud OAuth2 Refresh Token
#
# Usage:
#   ./scripts/chrome-webstore-upload.sh
#

set -euo pipefail

# Validate required env vars
for var in EXTENSION_ID CLIENT_ID CLIENT_SECRET REFRESH_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set. See script comments for setup instructions."
    exit 1
  fi
done

# Build if dist doesn't exist
if [ ! -d "dist" ]; then
  echo "Building extension..."
  npm run build:dict
  npm run build
fi

# Package
echo "Packaging extension..."
cd dist
zip -r ../tenzhong.zip .
cd ..

# Upload
echo "Uploading to Chrome Web Store..."
chrome-webstore-upload upload \
  --source tenzhong.zip \
  --extension-id "$EXTENSION_ID" \
  --client-id "$CLIENT_ID" \
  --client-secret "$CLIENT_SECRET" \
  --refresh-token "$REFRESH_TOKEN"

# Publish
echo "Publishing..."
chrome-webstore-upload publish \
  --extension-id "$EXTENSION_ID" \
  --client-id "$CLIENT_ID" \
  --client-secret "$CLIENT_SECRET" \
  --refresh-token "$REFRESH_TOKEN"

echo "Done! Extension published to Chrome Web Store."
