#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/stephen/projects/astro-cms
SITE=/home/stephen/sites/happymonkey
cd "$ROOT"
bash spike/themes/happymonkey/scripts/prepare-build.sh
# Touch seed so COPY layer busts if needed
touch spike/themes/happymonkey/.build/seed/seed.json
cd spike/themes/happymonkey/.build
echo "Building image..."
docker build -t astro-cms/site:happymonkey . 2>&1 | tee /tmp/hm-docker-build.log | tail -30

cd "$SITE"
set -a
source .env
set +a
docker compose down -v
docker compose up -d
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4510/ || true)
  [[ "$code" == "200" ]] && break
  sleep 2
done
# Always force CLI seed (auto-apply was silent-failing on validation)
docker exec \
  -e "DATABASE_URL=postgres://cms:${POSTGRES_PASSWORD}@db:5432/cms" \
  happymonkey-site-1 \
  ./node_modules/.bin/emdash seed /app/seed/seed.json 2>&1 | tee /tmp/hm-seed-apply.log | tail -40

curl -s -o /dev/null http://127.0.0.1:4510/
curl -s -o /dev/null http://127.0.0.1:4510/projects
curl -s -o /dev/null http://127.0.0.1:4510/posts
node /tmp/remote-claim.mjs
bash /tmp/remote-smoke.sh
