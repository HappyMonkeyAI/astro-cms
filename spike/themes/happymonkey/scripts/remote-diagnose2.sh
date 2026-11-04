#!/usr/bin/env bash
set -euo pipefail
echo "=== container seed ==="
docker exec happymonkey-site-1 node - <<'NODE'
const s = require("./seed/seed.json");
console.log("name", s.meta && s.meta.name);
console.log("collections", (s.collections || []).map((c) => c.slug).join(","));
console.log("content keys", Object.keys(s.content || {}).join(","));
console.log("home layout blocks", (((s.content || {}).pages || []).find((p) => p.slug === "home") || {}).data?.layout?.length);
NODE

echo "=== home text bits ==="
curl -s http://127.0.0.1:4510/ > /tmp/hm.html
python3 - <<'PY'
from pathlib import Path
html = Path("/tmp/hm.html").read_text(errors="ignore")
for needle in ["Happy Monkey", "Home layout missing", "ZeroG", "conversation", "empty-state", "Projects"]:
    print(needle, "YES" if needle in html else "NO")
print("len", len(html))
PY

echo "=== db ==="
# credentials from compose
set -a
# shellcheck disable=SC1091
source /home/stephen/sites/happymonkey/.env
set +a
docker exec happymonkey-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\dt' | head -80
