#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
SITE=/home/stephen/sites/happymonkey
cd "$ROOT"
rm -rf spike/themes/happymonkey/.build/node_modules || true
bash spike/themes/happymonkey/scripts/prepare-build.sh
grep -q 'hm-accent' spike/themes/happymonkey/.build/src/layouts/Base.astro
test -f spike/themes/happymonkey/.build/public/images/HappyMonkey-dark-logo.png
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey . 2>&1 | tee /tmp/hm-brand-build.log | tail -25
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
    ("monkey logo img", "HappyMonkey-dark-logo.png" in html),
    ("two-tone accent", "hm-accent" in html and "Monkey.AI" in html),
    ("Happy text", ">Happy<" in html or "Happy<span" in html),
    ("no letter mark", "brand__mark" not in html),
]
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
raise SystemExit(0 if all(ok for _, ok in checks) else 1)
PY
