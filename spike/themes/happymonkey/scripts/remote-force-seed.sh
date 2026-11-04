#!/usr/bin/env bash
set -euo pipefail
SITE=/home/stephen/sites/happymonkey
cd "$SITE"
set -a
source .env
set +a

echo "Applying seed via emdash CLI..."
docker exec \
  -e "DATABASE_URL=postgres://cms:${POSTGRES_PASSWORD}@db:5432/cms" \
  happymonkey-site-1 \
  ./node_modules/.bin/emdash seed /app/seed/seed.json 2>&1 | tee /tmp/hm-seed-apply.log | tail -80

echo "==== smoke markers ===="
curl -s http://127.0.0.1:4510/ -o /tmp/hm.html
python3 <<'PY'
from pathlib import Path
html = Path("/tmp/hm.html").read_text(errors="ignore")
for needle in ["Happy Monkey", "Home layout missing", "ZeroG", "conversation", "Projects"]:
    print(f"{needle}: {'YES' if needle in html else 'NO'}")
PY
