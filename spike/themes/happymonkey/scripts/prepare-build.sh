#!/usr/bin/env bash
# Prepare a build directory: copy spike/emdash-site, then overlay HappyMonkey theme files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
THEME="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/spike/emdash-site"
OUT="${1:-$ROOT/spike/themes/happymonkey/.build}"

rm -rf "$OUT"
mkdir -p "$OUT"
# Prefer rsync; fall back to tar
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude node_modules --exclude dist --exclude .git "$SRC/" "$OUT/"
else
  tar -C "$SRC" --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -C "$OUT" -xf -
fi

cp -f "$THEME/astro.config.mjs" "$OUT/astro.config.mjs"
cp -f "$THEME/src/styles/theme.css" "$OUT/src/styles/theme.css"
cp -f "$THEME/seed/seed.json" "$OUT/seed/seed.json"
cp -f "$THEME/Dockerfile" "$OUT/Dockerfile"
mkdir -p "$OUT/src/components/blocks" "$OUT/src/pages/projects"
cp -f "$THEME"/src/components/blocks/*.astro "$OUT/src/components/blocks/"
cp -f "$THEME/src/pages/index.astro" "$OUT/src/pages/index.astro"
cp -f "$THEME/src/pages/projects/index.astro" "$OUT/src/pages/projects/index.astro"
cp -f "$THEME/src/pages/projects/[slug].astro" "$OUT/src/pages/projects/[slug].astro"
cp -f "$THEME/DESIGN.md" "$OUT/DESIGN.md"
cp -f "$THEME/COMPOSITION.md" "$OUT/COMPOSITION.md"
# Static brand assets (header video, poster)
if [ -d "$THEME/public" ]; then
  mkdir -p "$OUT/public"
  cp -a "$THEME/public/." "$OUT/public/"
fi

# Search should include projects; load Font Awesome for tool icons (matches live site)
python3 - "$OUT" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]) / "src/layouts/Base.astro"
t = p.read_text()
old = 'collections={["posts", "pages"]}'
new = 'collections={["posts", "pages", "projects"]}'
if old in t:
    t = t.replace(old, new, 1)
    print("patched Base.astro search collections")
elif new in t:
    print("Base.astro already patched")
else:
    print("warning: Base.astro search collections pattern not found")

fa = """\t\t<link
\t\t\trel="stylesheet"
\t\t\thref="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
\t\t\tcrossorigin="anonymous"
\t\t\treferrerpolicy="no-referrer"
\t\t/>
"""
marker = "<EmDashHead page={pageCtx} />"
if "font-awesome" not in t and marker in t:
    t = t.replace(marker, marker + "\n" + fa, 1)
    print("patched Base.astro Font Awesome")
elif "font-awesome" in t:
    print("Font Awesome already present")
else:
    print("warning: could not inject Font Awesome")

p.write_text(t)
PY

echo "Prepared build context at $OUT"
