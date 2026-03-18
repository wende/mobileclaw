#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$SCRIPT_DIR/MobileClaw/Resources/web"
API_DIR="$PROJECT_ROOT/app/api"
API_BACKUP="$PROJECT_ROOT/.api_backup_for_export"
DIST_DIR_REL=".next-ios"
DIST_DIR="$PROJECT_ROOT/$DIST_DIR_REL"

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
fi
mkdir -p "$API_DIR"

# Clean stale build cache that references moved API routes
rm -rf "$DIST_DIR" "$PROJECT_ROOT/out" "$PROJECT_ROOT/.next/dev/types"

NEXT_EXPORT=1 NEXT_DIST_DIR="$DIST_DIR_REL" pnpm next build

echo "Copying output to $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"
EXPORT_DIR=""
if [ -d "$PROJECT_ROOT/out" ]; then
  EXPORT_DIR="$PROJECT_ROOT/out"
elif [ -d "$DIST_DIR" ]; then
  EXPORT_DIR="$DIST_DIR"
else
  echo "Error: no export output found (checked '$PROJECT_ROOT/out' and '$DIST_DIR')."
  exit 1
fi

cp -R "$EXPORT_DIR"/ "$DEST/"

# Copy shared config files used by both web and native
cp "$PROJECT_ROOT/shared/contextPrefixes.json" "$SCRIPT_DIR/MobileClaw/Resources/contextPrefixes.json"

echo "Done. $(find "$DEST" -type f | wc -l | tr -d ' ') files copied."
