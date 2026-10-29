#!/usr/bin/env bash
# Throwaway astro-cms sites for live tests: own database, claimed, admin token ready.
#
#   site.sh up <name> [port]   start (or restart) a site on http://localhost:<port> (default 4330)
#   site.sh down <name>        remove the container and drop its database
#   site.sh list               show throwaway sites
#
# `up` writes .throwaway/<name>.env (BASE, EMDASH_TOKEN, ADMIN_EMAIL, ADMIN_PASSWORD); `source` it.
# An existing database is kept, so `up` after an image rebuild tests the upgrade path.
set -euo pipefail

ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SITE_DIR="$ROOT/spike/emdash-site"
STATE="$ROOT/.throwaway"
IMAGE=${IMAGE:-astro-cms/site:spike}
NETWORK=emdash-site_default
DB_CONTAINER=emdash-site-db-1
PREFIX=throwaway-

die() { echo "site.sh: $*" >&2; exit 1; }
valid_name() { [[ $1 =~ ^[a-z][a-z0-9_]{0,30}$ ]] || die "name must match [a-z][a-z0-9_]* (it becomes the database name)"; }
psql_q() { docker exec "$DB_CONTAINER" psql -U emdash -d "${2:-postgres}" -tAc "$1"; }

up() {
	local name=$1 port=${2:-4330} base
	valid_name "$name"
	base="http://localhost:$port"
	docker image inspect "$IMAGE" >/dev/null 2>&1 || die "no image $IMAGE; build it: (cd spike/emdash-site && docker compose build emdash)"
	docker compose -f "$SITE_DIR/compose.yaml" up -d --wait db mailpit >/dev/null
	[[ -n $(psql_q "select 1 from pg_database where datname = '$name'") ]] || psql_q "create database $name" >/dev/null
	docker rm -f "$PREFIX$name" >/dev/null 2>&1 || true
	docker run -d --name "$PREFIX$name" --network "$NETWORK" -p "127.0.0.1:$port:4321" \
		-e "DATABASE_URL=postgres://emdash:emdash-spike@db:5432/$name" \
		-e "UPLOADS_DIR=/app/data/$name-uploads" \
		-e "EMDASH_SITE_URL=$base" \
		-e "SMTP_URL=smtp://mailpit:1025" \
		"$IMAGE" >/dev/null
	for _ in $(seq 1 60); do curl -sf "$base/_emdash/api/health" >/dev/null && break; sleep 3; done
	curl -sf "$base/_emdash/api/health" >/dev/null || die "site didn't become healthy; docker logs $PREFIX$name"

	mkdir -p "$STATE"
	local env="$STATE/$name.env" email="admin@$name.example" password
	if [[ -f $env ]]; then
		# shellcheck disable=SC1090
		source "$env"; password=$ADMIN_PASSWORD
	else
		password="throwaway-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
	fi
	local token
	token=$(node "$(dirname "$0")/claim.mjs" "$base" "$email" "$password") || die "claim/token failed"
	printf 'BASE=%s\nEMDASH_TOKEN=%s\nADMIN_EMAIL=%s\nADMIN_PASSWORD=%s\n' "$base" "$token" "$email" "$password" >"$env"
	echo "up: $base (admin $email). Run: set -a; source $env; set +a"
}

down() {
	local name=$1
	valid_name "$name"
	docker rm -f "$PREFIX$name" >/dev/null 2>&1 || true
	psql_q "drop database if exists $name with (force)" >/dev/null
	rm -f "$STATE/$name.env"
	echo "down: $name removed"
}

case ${1:-} in
up) [[ $# -ge 2 ]] || die "usage: site.sh up <name> [port]"; up "$2" "${3:-}" ;;
down) [[ $# -eq 2 ]] || die "usage: site.sh down <name>"; down "$2" ;;
list) docker ps -a --filter "name=^$PREFIX" --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' ;;
*) die "usage: site.sh up <name> [port] | down <name> | list" ;;
esac
