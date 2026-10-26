# EmDash spike

The decision-gate test from `../CONTEXT.md`: is EmDash a sound base for a self-hosted, Node-first agency distribution?

**Setup:**
- emdash@1.3.1 with the `blog` template, Node platform and Astro 7.4.2.
- Run in Docker (`node:24-bookworm-slim`) against Postgres 17.
- Media goes to local storage on a volume.
- Stack: `emdash-site/compose.yaml`. Fixtures: `fixtures/`.

```bash
cd emdash-site
docker compose up -d --build     # http://localhost:4321  admin: /_emdash/admin
docker compose down -v           # wipe the database and uploads
```

## Checklist

| # | Test | Status |
|---|---|---|
| 1 | Run on Node + Postgres in Docker | ✅ Works, with 3 serious caveats (F1–F3) |
| 2a | WordPress import: theme unit test data (`fixtures/themeunittestdata.wordpress.xml`) | ✅ Done. Content imports cleanly, but migration fidelity has major gaps (F11–F13). Reports: `results/` |
| 2b | WordPress import: a real client WXR export | ⏳ Needs a file |
| 3 | Drive the site through MCP with Claude (realistic editing tasks) | ⏳ Needs admin setup + token |
| 4 | Write a trivial plugin + admin page | 🟡 Started: an auth provider (`emdash-site/packages/auth-password`), not yet a plugin |

## Findings

Severity: 🔴 blocks the Node/Postgres story · 🟠 needs work in our layer · 🟢 good news

- **F1 🔴 The database config is serialised into the build output.**
  - `emdash({...})` config is evaluated in `astro.config.mjs` and written as JSON into `dist/server/chunks/config_*.mjs`.
  - With the documented `postgres({ connectionString: process.env.DATABASE_URL })`:
    - If `DATABASE_URL` is missing at build time, the setting is silently dropped (`"config": {}`) and the app connects to `127.0.0.1:5432` at runtime.
    - If `DATABASE_URL` is present at build time, **the password is embedded in `dist/` and therefore in the Docker image.**
  - S3 storage reads its env vars at runtime (`dist/storage/s3.mjs`). Postgres does not.
  - I found no upstream issue (searched 2026-10-25), so this is a good first upstream contribution.
  - The spike works around it with a build arg, which is only acceptable because the password is a throwaway local one.
- **F2 🔴 Full-text search is SQLite-only.**
  - On Postgres, seeding logs `Full-text search is only available with SQLite databases` for posts and pages.
  - The template's `/search` still renders but returns nothing.
  - Opening for us: a Postgres search provider (tsvector/pg_trgm).
- **F3 🟠 Other values are also fixed at build time, including the storage directory.**
  - Setting it through env at runtime does nothing, so uploads silently go to the container's temporary filesystem unless the path is fixed at build time.
  - Rule for our distribution: one image per environment, or patch EmDash to resolve config at runtime.
- **F4 🟠 The database driver is chosen at build time.** The same build can't switch between SQLite and Postgres.
- **F5 🟢 Agent-ready from the start.** The scaffold ships `AGENTS.md`, `.agents/skills/` (site building, plugins, CLI) and a docs MCP server in `.mcp.json`, `.cursor/` and `.vscode/`.
- **F6 🟢 Schema in Git partly exists already.** The `seed/seed.json` collections (fields, `supports`, `urlPattern`) are applied on first start. Still to test: whether seed changes are re-applied to an existing site, which decides whether "schema in Git" is ours to build.
- **F7 🟢 Runtime migrations work on Postgres.** 73 tables were created automatically on the first request.
- **F9 🟢 Auth is extensible without forking.**
  - EmDash has no password login: only passkeys, magic links, OAuth (GitHub, Google, Microsoft, AT Protocol), invites and a dev-only bypass.
  - Its `authProviders` API (routes, admin React components, a `SetupStep`, namespaced storage) let us add email + password sign-in as a self-contained package of about 300 lines (`@astro-cms/auth-password`). No EmDash files were changed.
  - Testing: 7 unit tests, plus an end-to-end API run covering setup, login, rejection of wrong and unknown credentials, 429 after 5 failures, and rejection of a cross-origin request.
  - Friction:
    - `createFirstAdmin` isn't exported, so we copied its locking SQL.
    - The wizard doesn't pass the email from the previous step to provider `SetupStep`s, so the form asks for it again.
    - Providers can't add admin pages, so there's no "change password" UI yet.
- **F10 🟠 An unclaimed instance can be claimed by anyone who reaches it.**
  - This is true of core passkey setup as well as our provider.
  - The deployment recipe must keep a fresh instance private (localhost, a VPN or an IP allowlist) until setup is complete, or pre-provision the admin from the CLI.
- **F11 🔴 The SSRF guard depends on Cloudflare DNS-over-HTTPS, even on Node.**
  - Every server-side fetch to an external host (including WordPress media import) resolves hostnames through `https://cloudflare-dns.com/dns-query`. It does not use the system resolver, and this can't be configured.
  - On networks that block public DoH (this one sinkholes `cloudflare-dns.com` to `0.0.0.0`, which is common on corporate and on-prem networks), every request fails with `SSRF_BLOCKED`. The import UI reports only "Failed to import media" (37 of 37).
  - Our spike patch (`emdash-site/scripts/patch-emdash-ssrf.mjs`, run in the Dockerfile) uses `node:dns` on Node and keeps the non-public-IP validation. With it, 37 of 37 media files imported.
  - No upstream issue exists. This is the second upstream contribution.
- **F12 🟢 The core content import is solid.**
  - Imported 79 of 79 entries (58 posts, 21 pages) in about 3 s with no errors. A re-import skipped all 79, so it's idempotent.
  - Status mapping is correct, including **`future` → scheduled with the date kept**. This contradicts the earlier desk research that said scheduled dates are lost.
  - All 68 categories and 110 tags were created, with 363 term assignments.
  - Gutenberg blocks became typed Portable Text: columns, cover, gallery, embed, table, code, pullquote, buttons and file.
  - Media is de-duplicated (37 files gave 36 media items).
- **F13 🔴 What's lost or wrong after migration.** These gaps are the case for our migration tooling.

  | Issue | Detail | Impact |
  |---|---|---|
  | **Shortcodes left as raw text** | 24 `[caption]`, 12 `[gallery]` and 1 `[audio]` render literally on the public site (e.g. `/posts/post-format-gallery` shows `[gallery columns="2"]`) | Visible breakage on any classic-editor site |
  | **Media URLs not rewritten** | 194 references in 13 entries still point at the old WordPress host after a successful media import. Only 6 URLs were rewritten, probably because size variants (`-150x150`) and gallery/link URLs don't match the media map exactly | The site still depends on the old server, and images break when it's shut down |
  | **Password-protected posts become public** | `template-password-protected` is published and its body ("should not be visible until the password is entered") is served to anonymous visitors | 🔴 **Privacy/security issue** in a migration |
  | **Page hierarchy lost** | 13 child pages are flattened (`ec_pages` has no parent column), and URLs become `/pages/{slug}` | Navigation and URLs change |
  | **No redirects** | 0 redirects created, and old permalinks (e.g. `/2008/09/03/template-sticky/`) return 404 | SEO and inbound links lost |
  | **Menus not imported from WXR** | The analysis found 0 menus despite 70 `nav_menu_item` references (the 1 menu present comes from the seed) | Manual rebuild |
  | **Comments not imported from WXR** | 33 in the source, 0 imported. The docs say this needs the exporter plugin | Lost unless the WP plugin route is used |
  | **Duplicate author bylines** | 2 WP authors produced 7 bylines (`Theme Buster` ×4, `Theme Reviewer` ×2, plus a malformed `>themereviewteam`). Confirms open upstream issue #3817 | Messy author data |
  | **`<!--more-->` / `<!--nextpage-->` dropped** | 4 and 5 in the source, 0 kept | Excerpts and pagination change |
  | **Sticky flag lost** | There's no equivalent field | Minor |
  | **Server-rendered blocks are empty** | e.g. `widgets-block-category` becomes an empty `htmlBlock` (as documented) | Minor |

- **F8 🟢 Small doc drift.** The docs give `/health`, but it returns 404. The real endpoint is `/_emdash/api/health`, which returns the version.
