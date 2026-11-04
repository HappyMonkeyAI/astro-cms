#!/usr/bin/env bash
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
cd "$SITE"

# Point at dogfood image; publish on LAN for staging smoke from the desktop.
sed -i 's|^ASTRO_CMS_IMAGE=.*|ASTRO_CMS_IMAGE=astro-cms/site:happymonkey|' .env
sed -i 's|^EMDASH_SITE_URL=.*|EMDASH_SITE_URL=http://192.168.5.215:4510|' .env
# compose port bind: loopback → all interfaces for staging
sed -i 's|"127.0.0.1:\${SITE_PORT}:4321"|"0.0.0.0:${SITE_PORT}:4321"|' compose.yaml

docker compose up -d
echo "waiting for site..."
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4510/_emdash/api/auth/session 2>/dev/null || true)
  if [ "$code" != "000" ] && [ -n "$code" ]; then
    echo "site responding http=$code after ${i}s"
    docker compose ps
    exit 0
  fi
  sleep 2
done
echo "timeout waiting for site"
docker compose ps
docker compose logs --tail 80 site || true
exit 1
