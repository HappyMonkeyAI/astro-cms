#!/usr/bin/env bash
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
set -a
source "$SITE/.env"
set +a
TOKEN=$(grep '^ADMIN_TOKEN=' "$SITE/credentials.txt" | cut -d= -f2-)
BASE=http://127.0.0.1:4510

echo "=== schema collections ==="
curl -s -H "Authorization: Bearer $TOKEN" -H "X-EmDash-Request: 1" -H "Origin: $BASE" \
  "$BASE/_emdash/api/schema/collections" | head -c 800; echo

echo "=== content list posts status all ==="
curl -s -H "Authorization: Bearer $TOKEN" -H "X-EmDash-Request: 1" -H "Origin: $BASE" \
  "$BASE/_emdash/api/content/posts?status=all&limit=10" | head -c 1000; echo

echo "=== db ec_posts count ==="
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 \
  psql -U cms -d cms -c "\dt ec_*" 
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 \
  psql -U cms -d cms -c "select id, slug, status from ec_posts limit 10;" 2>&1 | head -30
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 \
  psql -U cms -d cms -c "select id, slug, status from ec_pages limit 10;" 2>&1 | head -30
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 \
  psql -U cms -d cms -c "select id, slug, status from ec_projects limit 5;" 2>&1 | head -20

echo "=== home html markers ==="
curl -s "$BASE/" -o /tmp/hm.html
python3 - <<'PY'
from pathlib import Path
html=Path('/tmp/hm.html').read_text(errors='ignore')
for n in ['Happy Monkey','Home layout missing','ZeroG','conversation','Projects','empty-state']:
    print(n, 'YES' if n in html else 'NO')
PY
