# Dogfood prompt: HappyMonkey.AI on EmDash (staging on 192.168.5.215)

Self-contained brief for an agent on **dev-215**. This is **not** a WordPress `wp-migrate` pilot. It stages the HappyMonkey brand theme as `astro-cms/site:happymonkey` beside the existing client pilot (`astro-cms/site:spike` on `:4500`).

## Goal

1. Build the HappyMonkey image from the theme overlay.
2. Create a site on port **4510**.
3. Claim admin, smoke-test routes, note leftovers.
4. Do **not** cut over nginx on `.80` / `happymonkey.ai`.

## Ground rules

- Keep `astro-cms/site:spike` and `~/sites/pilot` intact.
- Do not commit secrets; put claim credentials in a gitignored file under the site dir or `client-data/happymonkey-credentials.txt`.
- Concept HTML dumps are forbidden as production bodies (see `spike/themes/happymonkey/COMPOSITION.md`).

## Prerequisites

- Repo at a known path (e.g. `~/astro-cms` or sync from desktop).
- Docker Compose v2, Node 24+.
- Theme overlay present: `spike/themes/happymonkey/` (`DESIGN.md`, seed, blocks, pages).

## Steps

### 1. Prepare build context and build image

```sh
cd /path/to/astro-cms
node spike/themes/happymonkey/scripts/generate-seed.mjs
bash spike/themes/happymonkey/scripts/prepare-build.sh
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey .
```

Expect 10–20+ minutes. Confirm image: `docker images astro-cms/site:happymonkey`.

### 2. Create site folder

```sh
cd /path/to/astro-cms
node spike/emdash-site/packages/cli/src/cli.ts new happymonkey --port 4510 --dir ~/sites
```

In `~/sites/happymonkey/.env` (or compose env): set `ASTRO_CMS_IMAGE=astro-cms/site:happymonkey`. If the generated compose binds `127.0.0.1` only and you need LAN access, change the publish to `0.0.0.0:4510:4321` or put Caddy/`--profile tls` in front. Set `EMDASH_SITE_URL` to the URL browsers use (tunnel or `http://192.168.5.215:4510`).

### 3. Start and claim

```sh
cd ~/sites/happymonkey
docker compose up -d
# Expect SETUP_LOCKED on admin until claimed via setup link / claim script
```

Claim with a password admin; mint an admin API token (24h+) for smoke edits.

### 3b. Seed content (if home shows “Home layout missing”)

Valid seed uses **snake_case** block field slugs. After claim, if collections exist but content is empty:

```sh
# From a machine that can reach the site API with the admin token:
node spike/themes/happymonkey/scripts/remote-api-seed.mjs
```

Do **not** rely on `emdash seed` inside the site container without pointing it at Postgres — it defaults to SQLite `/app/data.db`.

### 4. Smoke checklist

| Check | Expect |
|-------|--------|
| `GET /` | Hero + projects + tools + insights + contact sections |
| `GET /projects` | Project grid |
| One project detail or external link | Opens |
| `GET /posts` | Insights list |
| One `/posts/{slug}` | Article body |
| `/pages/privacy-policy` | Legal prose |
| Search | Finds a post/project |
| Cookie banner | Present (plugin) |
| Admin edit | Can edit a draft insight |
| `backup.sh` | Completes |

### 5. Report

Write `spike/results/happymonkey-dogfood-handoff.md` (generic; no passwords):

- Image tag / commit
- Verdict: staging usable or blocked
- What worked / leftovers (forms recipients, media fetch, design drift)
- Exact re-run commands

## Retest

After theme fixes on `main`: pull, regenerate seed if needed, `prepare-build`, rebuild image, recreate or upgrade the compose site (`up` keeps DB; `down -v` for clean seed).

## Cutover (later, human gate)

Only after staging sign-off: point nginx on `192.168.5.80` at EmDash, set `EMDASH_SITE_URL=https://happymonkey.ai`, keep `happymonkey-site` static deploy as rollback.
