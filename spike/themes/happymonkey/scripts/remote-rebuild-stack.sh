#!/usr/bin/env bash
# Rebuild happymonkey image with stack brand marks in the proof strip.
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
SITE=/home/stephen/sites/happymonkey
cd "$ROOT"
rm -rf spike/themes/happymonkey/.build/node_modules || true
bash spike/themes/happymonkey/scripts/prepare-build.sh
test -f spike/themes/happymonkey/.build/public/images/stack/openai.svg
test -f spike/themes/happymonkey/.build/src/components/blocks/ProseBand.astro
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey . 2>&1 | tee /tmp/hm-stack-build.log | tail -25
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
    ("stack mark img", "/images/stack/openai.svg" in html),
    ("hm-client-logo__mark", "hm-client-logo__mark" in html),
    ("OpenAI name", "OpenAI" in html),
]
for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)
raise SystemExit(0 if all(ok for _, ok in checks) else 1)
PY
curl -s -o /dev/null -w "openai:%{http_code}\n" http://127.0.0.1:4510/images/stack/openai.svg
curl -s -o /dev/null -w "voiceflow:%{http_code}\n" http://127.0.0.1:4510/images/stack/voiceflow.svg
