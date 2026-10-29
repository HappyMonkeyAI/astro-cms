---
name: throwaway-site
description: Start, claim and remove throwaway astro-cms sites (own Postgres database, admin API token ready) for live tests of wp-migrate, plugins and EmDash patches. Use when a change needs checking against a real running site rather than unit tests, when reproducing a pilot problem, or when testing an upgrade of an existing site after an image rebuild.
---

# Throwaway sites

Each site is a container from the `astro-cms/site:spike` image on the spike's compose network. It gets its own database in the compose Postgres, sends mail to Mailpit (`http://localhost:8025`), and is claimed with a password admin plus a 7-day admin-scope API token.

## Use

```bash
S=.claude/skills/throwaway-site/site.sh
$S up f30 4324                                   # start + claim; prints how to load the env
set -a; source .throwaway/f30.env; set +a        # BASE, EMDASH_TOKEN, ADMIN_EMAIL, ADMIN_PASSWORD
node spike/emdash-site/packages/wp-migrate/src/cli.ts migrate client-data/<export>.xml \
  --out client-data/f30-out --base "$BASE" --production-url https://example.com
$S down f30                                      # container + database + env file gone
```

- **`up` on an existing name keeps the database**, recreating only the container. That makes it the upgrade test: rebuild the image, run `up` again, then check that the old data still works. To start clean, run `down` first.
- **`list`** shows every throwaway site.
- **Port:** the default is 4330. Pick a different port for each site you run at once. `:4321` belongs to the compose `emdash` service.
- **Inspect a site's database:** `docker exec emdash-site-db-1 psql -U emdash -d <name> -c "…"`. Plugin data is in `_plugin_storage` and `_plugin_indexes`; content is in `ec_<collection>`.
- **REST calls** need the `Authorization: Bearer $EMDASH_TOKEN`, `X-EmDash-Request: 1` and `Origin: $BASE` headers.

## Before you start

- **The image must contain your change.** Run `cd spike/emdash-site && docker compose build emdash`; the service is `emdash`, not `site`. It takes 10–20 minutes, so run it in the background. A change to `scripts/patch-emdash.mjs`, `plugins/` or `packages/` needs a rebuild. A `wp-migrate` change doesn't, because the CLI runs from source on the host.
- **No setup lock.** The site starts without `SETUP_TOKEN`, so the setup-guard lock (F10) is open. To test the lock, use `astro-cms new` instead.
- **Plugin storage indexes appear late.** EmDash syncs them on the first scheduler tick, about a minute after the process starts. A test of an index has to poll for it.
- **Keep client material out of git.** Real exports and migration output belong in `client-data/`, which is gitignored. `.throwaway/` holds the credentials and is gitignored too.

## Writing a live test

Put the checks in a script, so the result is a count you can report, such as "12/12". Print PASS or FAIL per check, then a total, as `forms-live.mjs` and the F30 test did. Check what users and the go-live check would see: the rendered page HTML, the REST responses, `go-live.json`, and Mailpit (`/api/v1/messages`). Where the bug was in the database, check the database too.

After the test, either run `down` or leave the site running and say so.
