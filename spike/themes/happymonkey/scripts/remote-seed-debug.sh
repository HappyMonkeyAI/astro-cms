#!/usr/bin/env bash
set -euo pipefail
# Inspect inlined seed apply + try CLI seed against empty DB
docker exec happymonkey-site-1 sh -c './node_modules/.bin/emdash --help 2>&1 | head -40'
echo "===="
# Pull a short slice of the seed chunk mentioning apply
docker exec happymonkey-site-1 sh -c 'grep -n -i "seed\|apply\|setup" /app/dist/server/chunks/seed_CIZte7pc.mjs | head -40'
echo "===="
# Compose env for DB URL
set -a
source /home/stephen/sites/happymonkey/.env
set +a
# Find postgres user/db from compose
grep -E 'POSTGRES|DATABASE' /home/stephen/sites/happymonkey/.env /home/stephen/sites/happymonkey/compose.yaml | head -30
