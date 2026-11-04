#!/usr/bin/env bash
# Rebuild happymonkey image with tool icons + logo strip; recreate site keeping DB.
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
SITE=/home/stephen/sites/happymonkey
cd "$ROOT"
# Free npm cache leftover from prior builds if disk is tight
if [ -d spike/themes/happymonkey/.build/node_modules ]; then
  rm -rf spike/themes/happymonkey/.build/node_modules || true
fi
bash spike/themes/happymonkey/scripts/prepare-build.sh
grep -q font-awesome spike/themes/happymonkey/.build/src/layouts/Base.astro
grep -q hm-tool__icon spike/themes/happymonkey/.build/src/components/blocks/ToolStrip.astro
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey . 2>&1 | tee /tmp/hm-icons-build.log | tail -30
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
    ("font-awesome link", "font-awesome" in html),
    ("tool icon class", "hm-tool__icon" in html),
    ("fa-robot", "fa-robot" in html),
    ("client logos", "hm-client-logo" in html or "hm-strip__logos" in html),
    ("OpenAI logo text", "OpenAI" in html),
]
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
raise SystemExit(0 if all(ok for _, ok in checks) else 1)
PY
