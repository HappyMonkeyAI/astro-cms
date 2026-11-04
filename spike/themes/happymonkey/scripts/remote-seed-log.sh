#!/usr/bin/env bash
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
set -a
source "$SITE/.env"
set +a
echo "=== full seed log ==="
cat /tmp/hm-seed-apply.log 2>/dev/null || echo no-log
echo "=== re-run seed verbose ==="
docker exec \
  -e "DATABASE_URL=postgres://cms:${POSTGRES_PASSWORD}@db:5432/cms" \
  happymonkey-site-1 \
  ./node_modules/.bin/emdash seed /app/seed/seed.json --help 2>&1 | head -40
echo "==== apply again ===="
docker exec \
  -e "DATABASE_URL=postgres://cms:${POSTGRES_PASSWORD}@db:5432/cms" \
  happymonkey-site-1 \
  ./node_modules/.bin/emdash seed /app/seed/seed.json 2>&1 | tee /tmp/hm-seed-apply2.log | tail -60
echo "==== counts ===="
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 \
  psql -U cms -d cms -c "select 'posts' as t, count(*) from ec_posts union all select 'pages', count(*) from ec_pages union all select 'projects', count(*) from ec_projects union all select 'tools', count(*) from ec_tools;"
