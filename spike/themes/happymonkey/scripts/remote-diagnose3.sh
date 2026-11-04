#!/usr/bin/env bash
set -euo pipefail
docker cp /tmp/check-seed.mjs happymonkey-site-1:/tmp/check-seed.mjs
docker exec happymonkey-site-1 node /tmp/check-seed.mjs
curl -s http://127.0.0.1:4510/ -o /tmp/hm.html
python3 <<'PY'
from pathlib import Path
html = Path("/tmp/hm.html").read_text(errors="ignore")
for needle in ["Happy Monkey", "Home layout missing", "ZeroG", "conversation", "empty-state", "Projects", "No posts yet"]:
    print(f"{needle}: {'YES' if needle in html else 'NO'}")
print("len", len(html))
# dump main text-ish
import re
text = re.sub(r"<[^>]+>", " ", html)
text = re.sub(r"\s+", " ", text)[:800]
print("TEXT:", text)
PY
set -a
source /home/stephen/sites/happymonkey/.env
set +a
echo "DB=$POSTGRES_DB USER=$POSTGRES_USER"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" happymonkey-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\dt' | head -80
