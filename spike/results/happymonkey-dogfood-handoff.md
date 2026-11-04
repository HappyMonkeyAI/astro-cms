# HappyMonkey EmDash dogfood handoff

**Date:** 2026-11-03 · **Verdict:** **STAGING USABLE** on DevHost `192.168.5.215:4510`  
**Image:** `astro-cms/site:happymonkey` (`311a97b4b407`)  
**Site:** `/home/stephen/sites/happymonkey` (compose; LAN bind `0.0.0.0:4510`)  
**Not cut over:** live `https://happymonkey.ai` remains the Astro site on `.80`.

## What landed

- Theme overlay: `spike/themes/happymonkey/` (`DESIGN.md`, `COMPOSITION.md`, blocks, projects routes, Poppins/`theme.css`, seed generator).
- Agent brief: `DOGFOOD-PROMPT.md`.
- Cutover deferred: `spike/themes/happymonkey/CUTOVER.md`.
- Smoke (`remote-smoke.sh`): **13/13 PASS** (home sections, projects, posts, legal pages, search, backup).
- Content seeded via admin API after claim (`scripts/remote-api-seed.mjs`) — 27 entries created and published.
- Agent write path: create draft insight + publish by slug → **200** (`remote-agent-edit.sh`).
- Design capture: measured staging home tokens match `DESIGN.md` brand (`#8b5cf6` / `#0f172a` / Poppins). Automated Spine `ensure_capture` via neo still broken (page.evaluate API); manual `record_capture` stored for `/`.

## Gotchas (document for retests)

1. **Seed field slugs** must be `snake_case` (not camelCase). Invalid seed fails validation; auto-apply is silent from the outside.
2. **Post bylines** in seed files use `{ "byline": "<id>" }`; REST create wants `bylineId` (we skip bylines on API seed for now).
3. **`emdash seed` CLI inside the site container defaults to SQLite `/app/data.db`**, not Compose Postgres. Prefer first-request auto-seed after a valid seed, or `remote-api-seed.mjs` against a claimed admin token.
4. **Claim before seed content** leaves an empty CMS if auto-seed already failed; recreate with `compose down -v` or API-seed.
5. **Disk on `.215`** filled during image export once; free space before rebuilds.

## Leftovers (non-blocking for staging)

- Contact is mailto until form recipients are configured in admin.
- Full insight HTML bodies not imported (excerpts + short PT only).
- Spine Design baselines not yet approved against staging URL.
- Live nginx cutover explicitly deferred.

## Re-run

```sh
cd /home/stephen/projects/astro-cms
node spike/themes/happymonkey/scripts/generate-seed.mjs
bash spike/themes/happymonkey/scripts/prepare-build.sh
cd spike/themes/happymonkey/.build && docker build -t astro-cms/site:happymonkey .
# then follow DOGFOOD-PROMPT.md; use remote-api-seed.mjs after claim if content empty
```

Credentials live only on the host: `/home/stephen/sites/happymonkey/credentials.txt` (gitignored site folder).
