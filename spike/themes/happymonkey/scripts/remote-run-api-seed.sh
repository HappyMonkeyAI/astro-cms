#!/usr/bin/env bash
set -uo pipefail
node /tmp/remote-api-seed.mjs 2>&1 | tee /tmp/hm-api-seed2.log | tail -150
echo "==== home ===="
curl -s http://127.0.0.1:4510/ -o /tmp/hm.html || true
python3 - <<'PY'
from pathlib import Path
html=Path('/tmp/hm.html').read_text(errors='ignore')
for n in ['Happy Monkey','Home layout missing','ZeroG','conversation','Projects']:
    print(n, 'YES' if n in html else 'NO')
PY
bash /tmp/remote-smoke.sh || true
