#!/bin/sh
# Back up the database and uploaded media into ./backups, keeping the newest $KEEP of each (default 14).
# Run from cron, e.g. `15 3 * * * cd /srv/<site> && sh backup.sh >> backups/backup.log 2>&1`.
# Copy ./backups (and .env, which holds the encryption key) off the server.
set -eu
cd "$(dirname "$0")"
# Git Bash on Windows: pass Windows paths to docker untouched (no-ops on Linux)
export MSYS_NO_PATHCONV=1
HERE="$(pwd -W 2>/dev/null || pwd)"
KEEP="${KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups

docker compose exec -T db pg_dump -U cms -d cms --format=custom > "backups/db-$stamp.dump.partial"
mv "backups/db-$stamp.dump.partial" "backups/db-$stamp.dump"

docker compose run --rm --no-deps -T --entrypoint tar -v "$HERE/backups:/backup" site \
	-czf "/backup/uploads-$stamp.tar.gz.partial" -C /app/data uploads
mv "backups/uploads-$stamp.tar.gz.partial" "backups/uploads-$stamp.tar.gz"

for pattern in 'db-*.dump' 'uploads-*.tar.gz'; do
	# shellcheck disable=SC2012
	ls -1t backups/$pattern 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f -- "$old"; done
done
echo "backup $stamp: $(du -h "backups/db-$stamp.dump" | cut -f1) database, $(du -h "backups/uploads-$stamp.tar.gz" | cut -f1) media"
