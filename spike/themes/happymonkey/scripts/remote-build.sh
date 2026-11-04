#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
BUILD="$ROOT/spike/themes/happymonkey/.build"
cd "$BUILD"
python3 - <<'PY'
from pathlib import Path
p = Path("src/layouts/Base.astro")
t = p.read_text()
old = 'collections={["posts", "pages"]}'
new = 'collections={["posts", "pages", "projects"]}'
if old in t:
    p.write_text(t.replace(old, new, 1))
    print("patched Base.astro search collections")
elif new in t:
    print("already patched")
else:
    print("pattern not found")
PY
nohup docker build -t astro-cms/site:happymonkey . > /tmp/hm-docker-build.log 2>&1 &
echo "BUILD_PID=$!"
echo "log=/tmp/hm-docker-build.log"
