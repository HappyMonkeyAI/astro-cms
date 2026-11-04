#!/usr/bin/env bash
set -euo pipefail
echo "=== home snippet ==="
curl -s http://127.0.0.1:4510/ | tr '\n' ' ' | head -c 1500; echo
echo "=== container seed meta ==="
docker exec happymonkey-site-1 node -e "const s=require('./seed/seed.json'); console.log(s.meta, Object.keys(s.content||{}), (s.collections||[]).map(c=>c.slug))"
echo "=== db tables ==="
docker exec happymonkey-db-1 psql -U emdash -d emdash -c "\dt" | head -60
echo "=== settings ==="
docker exec happymonkey-db-1 psql -U emdash -d emdash -c "select * from site_settings limit 5;" 2>&1 | head -20
