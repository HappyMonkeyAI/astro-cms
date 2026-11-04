#!/usr/bin/env bash
# Rebuild happymonkey image with hero video assets; recreate site container keeping DB.
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
SITE=/home/stephen/sites/happymonkey
cd "$ROOT"
bash spike/themes/happymonkey/scripts/prepare-build.sh
test -f spike/themes/happymonkey/.build/public/videos/header-video.mp4
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey . 2>&1 | tee /tmp/hm-hero-build.log | tail -25
cd "$SITE"
docker compose up -d --force-recreate site
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4510/ || true)
  [[ "$code" == "200" ]] && break
  sleep 2
done
curl -s http://127.0.0.1:4510/ -o /tmp/hm.html
python3 - <<'PY'
from pathlib import Path
html = Path("/tmp/hm.html").read_text(errors="ignore")
checks = [
    ("video tag", "<video" in html),
    ("header-video src", "header-video.mp4" in html),
    ("hero heading", "Happy Monkey AI" in html),
]
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
raise SystemExit(0 if all(ok for _, ok in checks) else 1)
PY
# Asset reachable
curl -s -o /dev/null -w "video:%{http_code} size:%{size_download}\n" http://127.0.0.1:4510/videos/header-video.mp4
curl -s -o /dev/null -w "poster:%{http_code}\n" http://127.0.0.1:4510/images/HappyMonkey-dark-logo.png
