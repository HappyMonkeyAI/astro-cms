#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
SITE=/home/stephen/sites/happymonkey
cd "$ROOT"
rm -rf spike/themes/happymonkey/.build/node_modules || true
bash spike/themes/happymonkey/scripts/prepare-build.sh
test -f spike/themes/happymonkey/.build/public/images/insights/placeholder.svg
grep -q 'post__placeholder-img' spike/themes/happymonkey/.build/src/components/PostCard.astro
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey . 2>&1 | tee /tmp/hm-ph-build.log | tail -25
cd "$SITE"
docker compose up -d --force-recreate site
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4510/ || true)
  [[ "$code" == "200" ]] && break
  sleep 2
done
curl -s http://127.0.0.1:4510/posts/tools-and-soft-launches -o /tmp/hm-post.html
python3 - <<'PY'
from pathlib import Path
html = Path("/tmp/hm-post.html").read_text(errors="ignore")
checks = [
    ("placeholder svg", "/images/insights/placeholder.svg" in html),
    ("placeholder class", "post__placeholder" in html),
]
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
raise SystemExit(0 if all(ok for _, ok in checks) else 1)
PY
curl -s -o /dev/null -w "asset:%{http_code}\n" http://127.0.0.1:4510/images/insights/placeholder.svg
