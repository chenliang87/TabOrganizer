#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"
OUT="$SCRIPT_DIR/TabOrganizer.zip"

if [ ! -d "$EXT_DIR" ]; then
  echo "Error: extension/ directory not found at $EXT_DIR" >&2
  exit 1
fi

rm -f "$OUT"
cd "$EXT_DIR"
zip -r "$OUT" . -x '*.DS_Store' -x '*.git*'

echo ""
echo "Packaged: $OUT"
echo "Size: $(du -h "$OUT" | cut -f1)"
echo ""
echo "Next steps:"
echo "  1. Go to https://chrome.google.com/webstore/devconsole"
echo "  2. Click 'New Item' and upload $OUT"
