#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$SCRIPT_DIR/MobileClaw/Resources/web"
API_DIR="$PROJECT_ROOT/app/api"
API_BACKUP="$PROJECT_ROOT/.api_backup_for_export"

# Static export doesn't support API routes — move them aside during build
cleanup() {
  if [ -d "$API_BACKUP" ]; then
    rm -rf "$API_DIR"
    mv "$API_BACKUP" "$API_DIR"
  fi
}
trap cleanup EXIT

echo "Building Next.js static export..."
cd "$PROJECT_ROOT"

rm -rf "$API_BACKUP"
if [ -d "$API_DIR" ]; then
  mv "$API_DIR" "$API_BACKUP"
  mkdir -p "$API_DIR"
fi

# Clean stale build cache that references moved API routes
rm -rf .next

NEXT_EXPORT=1 pnpm next build

echo "Copying output to $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R out/ "$DEST/"

echo "Done. $(find "$DEST" -type f | wc -l | tr -d ' ') files copied."
