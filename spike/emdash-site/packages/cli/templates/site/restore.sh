#!/bin/sh
# Restore a backup made by backup.sh: sh restore.sh <stamp>   (e.g. 20261028T031500Z)
# Replaces the current database and media. The site is stopped while restoring.
# Restore .env too if this is a new server: the encryption key must match the backup.
set -eu
cd "$(dirname "$0")"
# Git Bash on Windows: pass Windows paths to docker untouched (no-ops on Linux)
export MSYS_NO_PATHCONV=1
HERE="$(pwd -W 2>/dev/null || pwd)"
stamp="${1:?usage: sh restore.sh <stamp>   (see ls backups/)}"
db="backups/db-$stamp.dump"
media="backups/uploads-$stamp.tar.gz"
[ -f "$db" ] || { echo "missing $db" >&2; exit 1; }
[ -f "$media" ] || { echo "missing $media" >&2; exit 1; }

docker compose stop site
docker compose up -d db
until docker compose exec -T db pg_isready -U cms -d cms >/dev/null 2>&1; do sleep 1; done
docker compose exec -T db pg_restore -U cms -d cms --clean --if-exists --no-owner < "$db"
docker compose run --rm --no-deps -T --entrypoint sh -v "$HERE/backups:/backup" site \
	-c "rm -rf /app/data/uploads/* && tar -xzf /backup/uploads-$stamp.tar.gz -C /app/data"
docker compose up -d site
echo "restored $stamp"
