#!/usr/bin/env bash
# SF Peek — Chrome Web Store packaging script
# Produces a clean submission ZIP using an explicit allowlist.
# Usage: bash scripts/package.sh   (or: npm run pack)

set -euo pipefail

VERSION=$(node -e "console.log(require('./manifest.json').version)")
OUT="sf-peek-v${VERSION}.zip"

# Remove previous build if exists
rm -f "$OUT"

zip "$OUT" \
  manifest.json \
  popup.html popup.js api.js \
  er.html er.js \
  files.html files.js \
  assets/icon16.png assets/icon48.png assets/icon128.png assets/output.css \
  lib/jszip.min.js \
  _locales/en/messages.json _locales/ja/messages.json

echo "Created: $OUT"
echo ""
echo "Contents:"
unzip -l "$OUT"
