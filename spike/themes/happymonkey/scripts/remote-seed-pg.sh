#!/usr/bin/env bash
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
set -a
source "$SITE/.env"
set +a
DBURL="postgres://cms:${POSTGRES_PASSWORD}@db:5432/cms"

echo "Seeding Postgres via -d DATABASE_URL..."
docker exec \
  -e "DATABASE_URL=$DBURL" \
  happymonkey-site-1 \
  ./node_modules/.bin/emdash seed /app/seed/seed.json -d "$DBURL" 2>&1 | tee /tmp/hm-seed-pg.log | tail -80

echo "==== counts ===="
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 \
  psql -U cms -d cms -c "select 'posts' as t, count(*) from ec_posts union all select 'pages', count(*) from ec_pages union all select 'projects', count(*) from ec_projects union all select 'tools', count(*) from ec_tools;"

curl -s http://127.0.0.1:4510/ -o /tmp/hm.html
python3 - <<'PY'
from pathlib import Path
html=Path('/tmp/hm.html').read_text(errors='ignore')
for n in ['Happy Monkey','Home layout missing','ZeroG','conversation','Projects']:
    print(n, 'YES' if n in html else 'NO')
PY
