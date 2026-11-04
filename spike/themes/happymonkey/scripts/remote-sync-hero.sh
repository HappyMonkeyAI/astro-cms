#!/usr/bin/env bash
set -euo pipefail
THEME=/home/stephen/projects/astro-cms/spike/themes/happymonkey
mkdir -p "$THEME/src/components/blocks" "$THEME/src/styles" "$THEME/scripts" "$THEME/seed" \
  "$THEME/public/videos" "$THEME/public/images"
cp /tmp/hm-hero/Hero.astro "$THEME/src/components/blocks/Hero.astro"
cp /tmp/hm-hero/theme.css "$THEME/src/styles/theme.css"
cp /tmp/hm-hero/DESIGN.md "$THEME/DESIGN.md"
cp /tmp/hm-hero/COMPOSITION.md "$THEME/COMPOSITION.md"
cp /tmp/hm-hero/seed.json "$THEME/seed/seed.json"
cp /tmp/hm-hero/prepare-build.sh "$THEME/scripts/prepare-build.sh"
cp /tmp/hm-hero/remote-rebuild-hero.sh "$THEME/scripts/remote-rebuild-hero.sh"
cp /tmp/hm-hero/generate-seed.mjs "$THEME/scripts/generate-seed.mjs"
chmod +x "$THEME/scripts/"*.sh
# Prefer LAN copy of video from .80 if present in /tmp; else leave existing
if [ -f /tmp/hm-hero/header-video.mp4 ]; then
  cp /tmp/hm-hero/header-video.mp4 "$THEME/public/videos/header-video.mp4"
fi
if [ -f /tmp/hm-hero/HappyMonkey-dark-logo.png ]; then
  cp /tmp/hm-hero/HappyMonkey-dark-logo.png "$THEME/public/images/HappyMonkey-dark-logo.png"
fi
ls -la "$THEME/public/videos" "$THEME/public/images" "$THEME/src/components/blocks/Hero.astro"
