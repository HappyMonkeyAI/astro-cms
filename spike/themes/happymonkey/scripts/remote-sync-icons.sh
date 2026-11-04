#!/usr/bin/env bash
# Sync icon/logo theme files from /tmp/hm-icons into the project theme tree.
set -euo pipefail
SRC=${1:-/tmp/hm-icons}
ROOT=/home/stephen/projects/astro-cms/spike/themes/happymonkey
mkdir -p "$ROOT/src/components/blocks" "$ROOT/src/styles" "$ROOT/scripts" "$ROOT/seed" "$ROOT/public/images"
cp -f "$SRC/ToolStrip.astro" "$ROOT/src/components/blocks/ToolStrip.astro"
cp -f "$SRC/ProseBand.astro" "$ROOT/src/components/blocks/ProseBand.astro"
cp -f "$SRC/theme.css" "$ROOT/src/styles/theme.css"
cp -f "$SRC/generate-seed.mjs" "$ROOT/scripts/generate-seed.mjs"
cp -f "$SRC/prepare-build.sh" "$ROOT/scripts/prepare-build.sh"
cp -f "$SRC/seed.json" "$ROOT/seed/seed.json"
cp -f "$SRC/remote-rebuild-icons.sh" "$ROOT/scripts/remote-rebuild-icons.sh"
chmod +x "$ROOT/scripts/prepare-build.sh" "$ROOT/scripts/remote-rebuild-icons.sh"
# Ensure logo asset present
if [ -f "$SRC/HappyMonkey-dark-logo.png" ]; then
  cp -f "$SRC/HappyMonkey-dark-logo.png" "$ROOT/public/images/HappyMonkey-dark-logo.png"
fi
ls -la "$ROOT/src/components/blocks/ToolStrip.astro" "$ROOT/src/components/blocks/ProseBand.astro"
echo SYNC_OK
