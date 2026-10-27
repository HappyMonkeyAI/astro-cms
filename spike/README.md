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
| 3 | Drive the site through MCP with Claude (realistic editing tasks) | ✅ Done. A strong base, with safety gaps for agency use (F14–F15). Client: `scripts/mcp.mjs`; task: `scripts/mcp-task-fix-gallery.mjs` |
| 4 | Write a plugin + admin page | ✅ Done. `emdash-site/plugins/migration-guard`: a sandboxed (workerd) plugin with hooks, a publish policy, storage, routes, MCP tools and a Block Kit admin page (F16–F17). Also an auth provider (`packages/auth-password`, F9) |

## Findings

Severity: 🔴 blocks the Node/Postgres story · 🟠 needs work in our layer · 🟢 good news

- **F1 🔴 The database config is serialised into the build output.**
  - `emdash({...})` config is evaluated in `astro.config.mjs` and written as JSON into `dist/server/chunks/config_*.mjs`.
  - With the documented `postgres({ connectionString: process.env.DATABASE_URL })`:
    - If `DATABASE_URL` is missing at build time, the setting is silently dropped (`"config": {}`) and the app connects to `127.0.0.1:5432` at runtime.
    - If `DATABASE_URL` is present at build time, **the password is embedded in `dist/` and therefore in the Docker image.**
  - S3 storage reads its env vars at runtime (`dist/storage/s3.mjs`). Postgres does not.
  - I found no upstream issue (searched 2026-10-25), so this is a good first upstream contribution.
  - The spike originally worked around it with a build arg, which was only acceptable because the password is a throwaway local one.
  - **Resolved without a patch (2026-10-27): `packages/runtime-config`** (also fixes F3).
    - `postgresFromEnv()` and `localFromEnv()` are descriptors whose `entrypoint` is our module.
    - EmDash bundles whichever module a descriptor names, and calls its `createDialect`/`createStorage` when the server starts. Our modules read `DATABASE_URL`/`UPLOADS_DIR` at that point, then delegate to EmDash's own adapters. Migrations already read `DATABASE_URL` at runtime through `manifestConfig.connectionStringEnv`.
    - **Acceptance test (SPEC §5.1) passed.** The image was built with no build args:
      - Scanning `dist/` for the DB password, `postgres://`, OAuth IDs and secrets, the SMTP host and the uploads path found 0 matches.
      - Image `Env` holds only Node defaults plus `HOST`/`PORT`, and the build history mentions no secrets.
      - Site 1 kept its content and media.
      - **A second container from the same image** got its own database (73 tables migrated and seeded, 0 users), its own Google client ID and redirect URI (`:4322`), and its own upload directory. An upload landed only in its own folder.
    - `EMDASH_SITE_URL` was already read at runtime.
- **F2 🔴 Full-text search is SQLite-only.**
  - On Postgres, seeding logs `Full-text search is only available with SQLite databases` for posts and pages.
  - The template's `/search` still renders but returns nothing.
  - Opening for us: a Postgres search provider (tsvector/pg_trgm).
- **F3 🟠 Other values are also fixed at build time, including the storage directory.**
  - Setting it through env at runtime does nothing, so uploads silently go to the container's temporary filesystem unless the path is fixed at build time.
  - Rule for our distribution: one image per environment, or patch EmDash to resolve config at runtime.
  - **Resolved** by `localFromEnv()` (see F1).
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
  - Our spike patch (`emdash-site/scripts/patch-emdash.mjs`, run in the Dockerfile) uses `node:dns` on Node and keeps the non-public-IP validation. With it, 37 of 37 media files imported.
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

- **F14 🟢 The MCP server is genuinely agent-grade.**
  - **Breadth:** 72 tools (as documented) with `readOnly`/`destructive` annotations, covering content, schema, media, taxonomies, menus, revisions, settings and site transfer.
  - **Safety:**
    - Writes need the `_rev` from the last read, and a stale write fails with `[CONFLICT] … modified since last read`.
    - An edit to a published item is **staged as a draft** until `content_publish`, and `content_compare` shows the diff.
    - Errors tell the agent how to fix them, e.g. "`_rev is required: call content_get … and pass back the _rev`".
    - Rich text accepts Markdown, which is cheap for an LLM.
  - **Scopes:** a `content:read`+`content:write` token gets `INSUFFICIENT_SCOPE` for `schema_delete_collection` and `settings_update`. Revoking a token takes effect immediately.
  - **Real task done end to end over MCP:** "replace the raw `[gallery]` shortcodes with real galleries from the imported media". The result is 10 galleries and 230 images served locally (optimised WebP), staged, compared, then published.
- **F15 🔴 Gaps for agency/client use, where our layer adds value.**

  | Gap | Evidence |
  |---|---|
  | **Destructive actions need no human approval** | An admin token dropped a collection *with content* by passing `force: true` itself. A **content-only** token **permanently deleted** a post in 2 calls (`content_delete` → `content_permanent_delete`, the latter with no `_rev`). Only `site_import_start` requires approval |
  | **The first edit to migrated content can't be undone** | The importer writes no revisions, so after an agent edit `revision_list` shows only the new revision and the original is unrecoverable inside EmDash |
  | **Edits are whole-field** | No block-level patch: changing one shortcode means re-sending the whole body (~50 KB here, which overflowed the Windows command line). This costs tokens and risks agents silently dropping blocks. Stable block-ID patch ops (the astro-spatial idea) would fix it |
  | **Built-in block formats aren't discoverable** | `schema_list_block_types` returns `[]`. `gallery`, `embed`, `image` etc. aren't described anywhere an agent can query, so the agent copied the format from an existing post and the renderer source |
  | **`revision_list` silently returns empty for a slug** | It needs the ULID, while other tools accept slugs. An agent would wrongly conclude there's no history |
  | **Import drops media metadata** | Alt text, captions, titles and the attachment→post relationship are all null, so `[gallery]` can only be resolved with the original WXR (which our tooling would keep) |
  | **Imported image references aren't linked to the media library** | Gutenberg galleries keep WP attachment IDs (`_ref: "755"`) and old-host URLs. Featured images are stored as `provider: "external"` with an empty id |
  | **`tools/list` ignores token scope** | A content-only token still sees all 72 tools, wasting agent context and inviting failed calls |
  | **No MCP tools for redirects, comments, users or plugins** | Redirect management matters most after a migration |
  | Not tested yet | Prompt injection through content an agent reads (e.g. instructions hidden in an imported post) |

- **F16 🟢 The plugin system is EmDash's strongest part, and most of our F13/F15 answers can be plugins rather than a fork.**
  - **Built:** `migration-guard`, a **sandboxed** plugin running in a workerd child process on Node.
    - Its trust contract is `content:read`, `schema:read` and `hooks.content-policy:register`.
    - `content:afterSave`/`afterDelete` hooks keep an issue list in plugin storage.
    - A `content:beforePublish` **policy** rejects publishing while raw shortcodes or legacy-host URLs remain, and logs each attempt's origin and actor.
    - `scan` and `issues` routes are exposed as **MCP tools**.
    - A Block Kit admin page shows stats, a hosts form, a rescan button and an issues table.
  - **Results on the imported site:**
    - The scan covered 80 entries in 0.33 s and flagged 15, matching the F13 inspection.
    - An agent using a `content:read`+`content:write`+`mcp:tools:migration-guard` token listed the issues through the plugin's MCP tool.
    - The agent's `content_publish` of a flagged post was refused with `[PUBLISH_REJECTED] Migration leftovers must be fixed before publishing: 1× [audio], 2 legacy-host URLs`. The clean post published.
    - Both attempts were logged with `origin: mcp`.
  - **Tests:** 6 tests pass through EmDash's production sandbox wrapper (`npm test`), and the typecheck is clean.
  - **Good security design:**
    - Capabilities are declared up front and printed when the plugin loads.
    - Plugin MCP tools need a separate admin consent step (`PUT /admin/plugins/:id/mcp`).
    - Even a full-`admin` token needs the explicit `mcp:tools:<pluginId>` scope to call them.
    - Error messages are actionable throughout.
  - **Implication:** the approval gate, migration quality gate and agent audit trail (F15) can largely ship as sandboxed plugins. Destructive-action approval is the exception: there's no `beforeDelete` origin and no hook for schema or permanent deletion.
- **F17 🟠 Plugin toolchain and docs friction** (each cost time, and each is a small upstream fix).

  | Issue | Detail |
  |---|---|
  | **workerd won't start in `node:*-slim` images** | `TLS configuration: … No CA certificates were loaded from the system`, after which every sandboxed plugin call fails. Fixed by installing `ca-certificates`. The sandbox docs don't mention it, and their Docker example uses a different base image |
  | **The scaffold pins stale tooling** | `plugin-cli init` writes `"emdash": ">=0.12.0 <1.0.0"` (1.3.1 is current) and `"@emdash-cms/plugin-test": "^0.1.0"`. On 0.x a caret never reaches 0.2, so the bundled test harness uses plugin-cli **0.11**, which rejects the documented `schema:read` and `hooks.content-policy:register` capabilities. Fixed with `plugin-test@^0.2.10` |
  | **Docs vs runtime: policy `origin`** | The docs say origins are strings (`api`, `mcp`, …), but the type and runtime use `{ source: "mcp" }`. Code written from the docs logs `[object Object]`, and origin checks silently never match |
  | **Docs vs types: sandbox support** | The `sandboxed` config JSDoc says it "only works on Cloudflare with Worker Loader", while the Node workerd runner works fine. Loading a *local* sandboxed plugin is only documented in the scaffold README |
  | **The docs reference APIs that don't exist** | `createPluginRuntimeTestHost()` isn't exported by `@emdash-cms/plugin-test` 0.1/0.2 |
  | **Publishing needs an Atmosphere identity even to scaffold** | `init --publisher <handle>` resolves the handle over the network. A placeholder `did:web:` works for local-only plugins |
  | **No token scope separates editing from publishing** | Valid token scopes are `content:read/write`, `media:*`, `schema:*`, `settings:*`, `menus:manage`, `taxonomies:manage`, `mcp:tools[:id]` and `admin`. `content:write` includes publishing and permanent deletion, so policy plugins are the only publish gate |
  | **The policy actor is the token's owner, not the token** | Multiple agents sharing one user can't be told apart in an audit trail |
  | **Two workerd versions get installed** | The site's `workerd` and miniflare's nested `workerd` (with its install script blocked by npm 11 `allowScripts`). It's harmless here but confusing |
  | Not tested | CPU and memory exhaustion by a hostile plugin. The docs say only the 30 s wall-time limit is enforced on Node |

### Client authentication (non-technical users; see CONTEXT.md "Authentication")

- **F18 🔴 On Node, OAuth (Google/Microsoft/GitHub) credentials are baked in at build time.**
  - The OAuth routes read `cfEnv ?? import.meta.env`, and on Node Vite inlines `import.meta.env` at build time.
  - With credentials set only at runtime, the routes say "OAuth provider google is not configured". When they're set at build time, the **client secret is written into 2 files in `dist/`** (and so into the image).
  - Our patch (`scripts/patch-emdash.mjs`, 2 lines) reads `process.env` at request time. After it, the runtime-only dummy credentials produce correct redirects to `accounts.google.com` and `login.microsoftonline.com/<tenant>`, with 0 secrets in `dist/`.
  - Same root cause as F1. This is the third upstream contribution.
  - **Verified with a real Google OAuth client (2026-10-27).** Credentials are in the gitignored `.env` only (runtime), and the downloaded `client_secret*.json` is gitignored.
    - **Uninvited Gmail:** rejected with "Self-signup is not allowed for your email".
    - **Invited the same Gmail as Editor:** accepted through Google, which created one Editor user (`email_verified=1`) and one linked `google` account, and used up the invite token.
    - **Signed out and back in with Google:** went straight in, with no duplicate user or link.
    - **Server log:** the rejection logs the error code only, not the email address.
- **F19 🟢 What already supports non-passkey users:**
  - **OAuth can accept invites.** The invite page passes `inviteToken` to every provider button, and the callback completes the invite only when the provider-verified email matches the invited address.
  - **Allowed domains:** `POST /admin/allowed-domains {domain, defaultRole}`, so anyone with a verified `@clientbusiness.example` Google/Microsoft account self-provisions as Editor. Tested through the API.
  - **Magic links:** tested end to end through our SMTP transport and Mailpit.
    - Sending is rate-limited (3 per 5 min per IP) and doesn't reveal whether an account exists. No email was sent for an unknown address.
    - Clicking the link leads to a confirmation page (POST), so email-scanner prefetches can't use it up.
    - Each link is single-use.
- **F20 🟠 Gaps found and filled (ours) or remaining.**

  | Gap | Status |
  |---|---|
  | **The built-in invite flow requires a passkey** (`invite/complete` only accepts a WebAuthn registration) | **Filled.** `auth-password` gained `POST /auth/password/invite-complete` plus an invite-aware `LoginButton` ("Use a password instead"). Tested: the invite is validated, weak passwords are rejected, the account is created with the invited role (Editor), the invite is single-use, and password sign-in works afterwards |
  | **No production email on Node except a community plugin** (`emdash-smtp`: 2★, one maintainer, trusted in-process, holds SMTP credentials) | **Filled.** `packages/email-smtp`, about 70 lines on `nodemailer`. It reads `SMTP_URL` at send time because plugin options are serialised at build (F1), and it never logs message bodies (they contain sign-in links). EmDash selected it automatically, and invite and magic-link emails were delivered to Mailpit |
  | **Microsoft sign-in is per tenant.** Emails are only "verified" through a configured tenant ID; `common`/`organizations` sign-ins aren't | Remaining. For an agency this means one Entra app (or tenant config) per client, or `emailVerified: true`, which weakens the check. Our distribution needs a provisioning script |
  | **OAuth app registration per site** (client ID/secret and redirect URI for each client domain) | Remaining. This is the biggest setup cost. Options: script it, or run a shared agency OAuth broker |
  | **No 2FA** for password accounts | Remaining. Planned as an email one-time code, not an authenticator app |
  | **No self-service password reset** | Partly covered: a magic link signs the user in, but there's no "set a new password" screen yet |

### Migration tooling (milestone 2)

- **F21 🔴 The WXR importer makes entries with non-ASCII slugs unreachable.**
  - WordPress stores such slugs percent-encoded in the export (`<wp:post_name>%ce%b5%cf%80…-2</wp:post_name>`), and EmDash stores that text verbatim as the slug.
  - Astro decodes the request path before the slug lookup, so `/pages/επίπεδο-2` in any encoding returns 404. The page exists but can never be reached.
  - Affects any site with accented or non-Latin slugs (French, German, Greek, …).
  - EmDash itself handles Unicode slugs fine: renaming the slug to `επίπεδο-3` over MCP made the page return 200.
  - `wp-migrate prepare` decodes post, category and tag slugs before import. This is a candidate upstream issue (decode `post_name` in the importer).
- **F22 🟢 EmDash core already has a full redirect system**, so the planned `redirects` plugin is dropped.
  - Features: `_emdash_redirects` with 301/302/307/308/410/451, pattern rules, hit counts, groups, a 404 log, DB-level loop validation and site-relative-only destinations.
  - It's managed through `/_emdash/api/redirects`, and an admin-scope PAT works.
  - There are no MCP tools for it (F15).
  - `wp-migrate redirects` writes there: 76/76 old permalinks → 301 → 200 on the theme unit test data.

- **F8 🟢 Small doc drift.** The docs give `/health`, but it returns 404. The real endpoint is `/_emdash/api/health`, which returns the version.
