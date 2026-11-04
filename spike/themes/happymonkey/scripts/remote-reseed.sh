#!/usr/bin/env bash
# Wipe DB volumes, start fresh, hit public routes so seed applies, then claim.
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
cd "$SITE"
docker compose down -v
docker compose up -d
echo "waiting for site..."
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4510/ || true)
  if [[ "$code" == "200" ]]; then
    echo "home $code after ${i} tries"
    break
  fi
  sleep 2
done
# Force a few routes so collections/content seed
for path in / /projects /posts /pages/privacy-policy; do
  curl -s -o /dev/null -w "%{http_code} $path\n" "http://127.0.0.1:4510$path" || true
done
sleep 2
curl -s http://127.0.0.1:4510/ -o /tmp/hm.html
if grep -q 'Happy Monkey AI' /tmp/hm.html; then
  echo "SEED_APPLIED"
else
  echo "SEED_MISSING"
  grep -o 'Home layout missing\|empty-state\|No posts' /tmp/hm.html | head || true
fi
node /tmp/remote-claim.mjs
bash /tmp/remote-smoke.sh || true
