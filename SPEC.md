# Spec: astro-cms distribution (v0.1)

Status: draft, 2026-10-27. Working name "astro-cms".
Inputs: `CONTEXT.md` (why, audiences, decisions) and `spike/README.md` (evidence, cited below as F1–F20).

## 1. Decision

The spike passed the gate in `CONTEXT.md`. **We build on EmDash** (pinned 1.3.x) rather than writing a core.

The core is sound on Node + Postgres:
- import (F12)
- MCP (F14)
- plugins (F16)
- auth extensibility (F9, F19)

Every blocker we found (F1, F3, F11, F18) has the same root cause: Cloudflare-first assumptions about config, env and network. Each is fixable with a small patch that we can contribute upstream. Nothing required a fork.

What we ship is a **distribution**: EmDash, our patches, our packages and plugins, a deployment recipe and an agency CLI.

## 2. Principles

1. **One image, many sites.**
   - No secret or site-specific value may be fixed at build time (F1, F3, F18).
   - The same image runs every client site, configured only by env and volumes.
2. **Additive, not forked.**
   - Our code lives in packages, plugins and providers.
   - Patches to EmDash are small and mechanical, listed in one script, and each has an upstream issue or PR.
3. **Sandboxed by default.**
   - Plugins run in the workerd sandbox unless they need Node APIs (SMTP, crypto, filesystem).
   - Native code is ours and reviewed.
4. **Agents are scoped, gated, attributable and reversible** (CONTEXT constraint).
5. **Clients never need to understand auth.**
   - SSO first, then magic link, then password.
   - Passkeys are optional (CONTEXT "Authentication").

## 3. Architecture

```
┌──────────────── Docker image: astro-cms/site (node:24-bookworm-slim + ca-certificates) ────────────────┐
│ Astro site (client theme)                                                                               │
│ └─ emdash 1.3.x  ── patched by @astro-cms/patches (runtime config, DNS, OAuth env)                       │
│    ├─ authProviders: password · google · microsoft            (+ passkey / magic link from core)       │
│    ├─ native plugins:   email-smtp · pg-search                                                         │
│    └─ sandboxed plugins (workerd): migration-guard · agent-guard · redirects                           │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ env: DATABASE_URL, SMTP_URL, EMDASH_OAUTH_*, EMDASH_ENCRYPTION_KEY, S3_* / UPLOADS_DIR
        ▼
   Postgres 17          S3-compatible or volume storage          SMTP relay

Agency machine:  astro-cms CLI  ── new site · OAuth provisioning · wp-migrate · tokens · upgrade
```

## 4. Packages

| Package | Kind | Responsibility | Spike state |
|---|---|---|---|
| `@astro-cms/runtime-config` | db + storage adapters | Read `DATABASE_URL` and `UPLOADS_DIR` at server start (F1, F3) | Built, accepted (§5.1) |
| `@astro-cms/patches` | build script | Apply and verify EmDash patches; **fail the build** if a target string isn't found (detects upstream drift) | `patch-emdash.mjs`: F11, F18 |
| `@astro-cms/auth-password` | auth provider | Password setup, login, invite acceptance; later email-code 2FA and password reset | Built, 7 tests (F9, F20) |
| `@astro-cms/email-smtp` | native plugin | `email:deliver` via nodemailer, `SMTP_URL` read at send time | Built (F20) |
| `@astro-cms/pg-search` | package + patch | Postgres full-text search (on-the-fly weighted tsvector) behind EmDash's own search functions | **Built** (F2): `search()`, the search and suggest APIs and the MCP tool work on Postgres. 6 unit tests, live test 23/23. About 0.5 ms per entry, so an index table is needed past roughly 1,000 entries |
| `@astro-cms/wp-migrate` | Node CLI | WXR preflight, prepare (pre-import passes) and post-import fix-ups (§5.2) | All §5.2 passes done, plus `migrate` (one command) and `check` (go-live); 39 tests. Awaiting a real client export |
| `migration-guard` | sandboxed plugin | Scan for WP leftovers, block publishing while they remain, issues admin page and MCP tools | Built, 6 tests (F16) |
| `agent-guard` | sandboxed plugin | Publish approval for agent-originated changes, audit log of agent actions | Done: revision-fenced approvals, 7 tests, live test 13/13 |
| `@astro-cms/setup-guard` | Astro integration | Locks setup and sign-in on a fresh site until opened with the setup link (F10) | Built, 4 tests; live 19/19 with the recipe |
| `@astro-cms/cli` | Node CLI | `astro-cms new` (deployable site folder: compose, .env secrets, Caddy, backup and restore); `astro-cms token …` presets; `astro-cms agent create/list/disable`; `astro-cms plugin new` | Done (token and agent commands) |
| ~~`redirects`~~ | — | **Not needed:** EmDash core has redirects (301–451, patterns, hit counts, 404 log, loop checks, admin API). `wp-migrate redirects` writes to it. Still missing: MCP tools for redirects (F15) | Dropped (2026-10-27) |
| `astro-cms` CLI | Node CLI | Site scaffolding, OAuth provisioning, `wp-migrate`, token management, upgrades | Scripts only (`spike/scripts/`) |

## 5. v0.1 scope (MVP)

Goal: **migrate one real client WordPress site and hand it over**, with the client signing in by Google or Microsoft and an agent doing routine edits safely.

### 5.1 Runtime configuration (blocks everything else)

- **Done (2026-10-27), with no patch:** `@astro-cms/runtime-config` provides `postgresFromEnv()` and `localFromEnv()`.
  - Their descriptors point EmDash at our own entrypoints, which read `DATABASE_URL` and `UPLOADS_DIR` when the server starts and then delegate to EmDash's adapters (F1, F3).
  - S3 storage and `EMDASH_SITE_URL` were already read at runtime.
- Keep the F11 (system DNS for the SSRF guard) and F18 (OAuth env at request time) patches.
- **Acceptance:**
  - Build the image with **no** env.
  - Run two containers from it against two databases with different OAuth apps and SMTP settings.
  - `grep` of the image finds no secrets.

### 5.2 WordPress migration (`astro-cms wp-migrate`)

Wraps the EmDash WXR import API (the spike's `wp-import.mjs`), then runs our fix-up passes:

| Pass | Fixes | Approach |
|---|---|---|
| Preflight | Report everything below *before* importing; keep the WXR for later passes | Parse the WXR |
| Protected content | Password-protected posts become public (F13 🔴) | Import as **draft** and list them in the report. Never publish them automatically. **Done (2026-10-27)** in `packages/wp-migrate`, covering private posts too: verified as draft with a public 404 on a fresh site |
| Shortcodes | `[caption]`, `[gallery]`, `[audio]`, `[video]`, `[embed]` left raw | Convert to Portable Text blocks using WXR attachment data; report unknown shortcodes. **Done (2026-10-27):** markers before import, real blocks after import over MCP. E2E: 25/25 converted, original publish dates kept |
| Media URLs | Size variants and gallery/link URLs still point at the old host | Map `-WxH` variants and attachment URLs to the media library; rewrite in place. **Done (2026-10-27):** generic walk over all fields, plus `--fetch-missing` for linked files the export didn't attach. E2E: 169 → 0 legacy references |
| Media metadata | Alt text, captions, titles and attachment parents dropped (F15) | Restore from the WXR into the media items |
| Hierarchy and URLs | Child pages flattened, permalinks changed | Keep the WP path as each entry's slug path, or generate redirects. **Decided: redirects** (EmDash pages have no parent). Nested paths 301 to `/pages/{slug}` |
| Redirects | Old permalinks 404 | Write every old URL → new URL into `redirects`. **Done (2026-10-27)** with **EmDash core redirects**, so no plugin is needed. Internal links are rewritten too. E2E: 76/76 → 301 → 200 |
| Non-ASCII slugs | Importer stores WP's percent-encoded slugs verbatim, so those entries are unreachable (F21) | **Done:** decode before import |
| Menus | Not imported | Rebuild from `nav_menu_item`. **Done (2026-10-27):** 5/5 menus, 70/70 items, nesting kept. Note: the blog template renders top-level menu items only, so client themes need dropdown rendering |
| Baseline revision | First agent edit to imported content can't be undone (F15) | Create a revision of every imported entry. **Done (2026-10-27):** 60 → 0 entries without history; undo via `revision_restore` verified |
| Media metadata | Alt text and captions dropped (F15) | Restore from the export, filling empty fields only. **Done:** alt text 28/37 (all the export had), captions 21 |
| Media without the old host | Old site offline, local or firewalled (F23) | **Done:** `--uploads <wp-content/uploads copy>` |
| Final gate | | `migration-guard` scan must report 0 issues before the site goes live. The publish gate allows "no worse than live" fixes on published entries (migration-guard 0.2.0, F23). **Done (2026-10-27):** `wp-migrate check`, also the last step of `wp-migrate migrate` (one command, 72 s on the test data). Proven to fail on a planted leftover |

**Out of v0.1:** comments, `<!--more-->`/`<!--nextpage-->`, sticky posts and author byline de-duplication. These are listed in the report as manual follow-ups.

**Acceptance:**
- On the theme unit test data plus one real client export:
  - 0 raw shortcodes
  - 0 old-host URLs
  - 0 password-protected entries published
  - every old permalink returns 301 or 200
  - every imported entry has a revision

### 5.3 Client authentication

As decided in CONTEXT "Authentication", building on F19 and F20.

- **Ship as built:** Google and Microsoft SSO, invites, allowed domains, magic link, password with invite acceptance.
- **Add:** a password reset screen and email-code 2FA in `auth-password`. **Done (2026-10-27):** 27 unit tests and a 26/26 live test through Mailpit.
  - Still open: an admin toggle for 2FA, styling the reset page to match the admin, and revoking sessions on reset (needs an EmDash hook).
- **OAuth model (decided 2026-10-27): one Google app, and one Microsoft Entra app when the client uses Microsoft 365, per client site.**
  - This keeps each site self-contained, with no shared service to run or secure.
  - A shared agency broker is deferred until onboarding volume justifies it.
- **`astro-cms oauth`:**
  - Prints the exact redirect URIs and consent-screen settings for a site.
  - Writes credentials to the site's env.
  - Checks a sign-in with a test request.
  - The agency still creates the app in the Google/Entra console by hand (about 5 minutes, using a checklist). Automating that is a later goal.
- **Acceptance:** a non-technical tester accepts an invite with Google, then with Microsoft, without help.

### 5.4 Agent safety

EmDash's MCP server is the interface. We don't build our own (F14).

- **Status (2026-10-27): done and live-tested** (24/24 checks across two runs). Details in spike F24.
  - **Prompt-injection evaluation (2026-10-30, spike F32):** a harness in `spike/injection-eval/` ran two open models. Neither acted on a planted instruction. The platform alone holds, except that an agent can trash a published page (open: an agent-guard delete gate).
  - The protections above were tested by acting as a fully compromised agent, so they hold regardless of model behaviour.
  - Model-level testing needs a dedicated, isolated harness (only the CMS tools available to the agent), not agents running on a developer machine.
- **Agent accounts.** Each agent gets its own non-admin user (`@agents.invalid`, no credentials) owning its token, via `astro-cms agent create` and `@astro-cms/auth-password`'s admin-only `/_emdash/api/agents`. Without this, an agent token created by an admin acts as the admin: EmDash checks the token *owner's* role, and edits are attributed to the owner. Disabling the account revokes its tokens at once.
- **Token profiles in the CLI.** Named presets map to EmDash scopes:
  - `agent-editor`: `content:read`, `content:write`, `media:read`, `media:write`, `mcp:tools:migration-guard`
  - `agent-readonly`
  - Agency admins hold `admin` tokens. Agents never do.
- **Agent publish approval** (`agent-guard` plugin):
  - A `content:beforePublish` policy rejects `origin.source === "mcp"` publishes unless an editor approved them in the admin page.
  - Every attempt is logged (pattern proven in F16).
- **Destructive actions:**
  - There is no `beforeDelete` / permanent-delete hook (F16), and `content:write` includes permanent delete (F17).
  - v0.1 mitigation: a patch that refuses `content_permanent_delete` and `schema_delete_collection` for non-`admin` tokens. **Done** for all six destructive tools (also schema field, media, taxonomy and menu deletes), by requiring the `admin` token scope. Trashing stays allowed.
  - Upstream: propose a delete policy hook.
- **Out of v0.1:**
  - block-level patch edits
  - discoverable block formats
  - scope-filtered `tools/list`
  - per-token actor IDs

  These are upstream proposals; F15 has the evidence.

### 5.5 Search

`pg-search` gives the site template's `/search` results on Postgres (F2).

**Status: built.** A patch makes EmDash's `searchWithDb`, `searchCollection` and `getSuggestions` hand off to `@astro-cms/pg-search` on Postgres, and `enableSearch` and `disableSearch` record the setting instead of throwing.
- Every caller works unchanged: the template's `search()`, `/_emdash/api/search`, `/suggest` and the MCP `search` tool.
- Results keep EmDash's shapes, cursors and `<mark>`-only snippets.
- **No index to sync:** each query builds a weighted tsvector from the searchable fields, so publish, unpublish and trash take effect immediately.
- **Cost:** linear, about 0.5 ms per published entry (500 entries ≈ 270 ms; 6,000 entries ≈ 1.3–3.2 s).
- **v0.2, for large sites:** a trigger-maintained tsvector table per collection with a GIN index.
- **Existing sites** enable search once with `POST /_emdash/api/search/enable`. New and imported sites enable it automatically.

### 5.6 Plugins: first-party catalogue and authoring kit

**Policy (decided 2026-10-27):**
- v0.1 runs **only our own plugins**.
- Building a plugin must be easy for us and for other developers from day one, so a third-party catalogue can open later without reworking anything.

**First-party catalogue.** Plugins WordPress clients expect, built on the `migration-guard` pattern (F16): sandboxed unless the plugin needs Node **or adds anything to public pages**. EmDash ignores `page:fragments` from sandboxed plugins (F25), so those are trusted packages.

| Plugin | Status |
|---|---|
| `cookie-consent` | **Built** (trusted, `packages/cookie-consent`). Equal-weight accept and reject, analytics and marketing categories, gating of `<script type="text/plain" data-consent="…">`, optional Google Consent Mode v2, a revision number to ask everyone again, and admin-editable text. Live test 13/13, browser check passed. A consent log is still to do |
| `slider` | **Built** (trusted, `packages/slider`). A carousel Portable Text block in the editor's slash menu, with a site renderer (`componentsEntry`) merged into `<PortableText>`. Scroll-snap without JavaScript; buttons, dots, arrow keys, and autoplay that respects reduced motion. Image and link URLs are restricted to safe ones. Live test 13/13, browser check and the admin insert, save and publish flow passed. Slides take image URLs (F26) |
| `forms` | **Adopted, not built:** EmDash's own `@emdash-cms/plugin-forms` (0.2.11, trusted) already has a form builder, a submissions inbox with CSV export, notifications (sent through `email-smtp`), a honeypot or Turnstile, webhooks and an `emdash-form` block. `wp-migrate` converts Contact Form 7, WPForms and Jetpack forms into it and their shortcodes into form blocks (spike F29) |
| ~~`sitemap`~~ | Dropped: EmDash core serves `sitemap.xml` and `robots.txt` |
| ~~`seo`~~ | Dropped: core has per-entry SEO fields and Open Graph |
| ~~`redirects`~~ | Dropped: core redirects (F22) |

Before building each plugin: check EmDash core and its existing plugins, then write a one-paragraph scope, then build it with the kit.

**Authoring kit.** This makes "easy to create" concrete:
- **`astro-cms plugin new <name>`** wraps `plugin-cli init`, fixing the problems we hit in F17:
  - current `emdash` and `plugin-test` versions
  - no network publisher lookup
  - no shortcut folders that break on Windows
  - pre-wired `npm test` and typecheck
- **A worked example and guide.** `migration-guard` is the reference: it uses hooks, a policy, storage, routes, MCP tools, an admin page and tests. The guide covers the gotchas we found, including the policy `origin` object, query values arriving as strings, and the `ca-certificates` requirement for the sandbox.
- **An agent skill for building plugins,** so Claude or another agent can write one from a brief. The EmDash scaffold already includes one, and we'd extend it with our conventions.
- **A local test loop:** unit tests through the sandbox wrapper, and a `compose` stack that loads a local plugin.

**Path to third-party plugins (post-MVP).**
- Accept plugins built with the kit that are **sandboxed only** and pass review: declared capabilities, tests, and no network access unless it's declared.
- Prerequisite: CPU and memory limits enforced on Node, or a decision to accept the 30 s wall-time limit (F17).

### 5.7 Deployment

- **`compose.yaml` recipe:** site, Postgres, an optional Mailpit for staging, and volumes. Image based on `node:24-bookworm-slim` with `ca-certificates` (F17).
- **Fresh-instance protection (F10):** `astro-cms new` pre-creates the first admin through the CLI, so no instance is ever reachable unclaimed.
- **Health check** on `/_emdash/api/health` (F8).
- **Backups:** `pg_dump` and the media volume (or S3).
- **Out of v0.1:** a managed hosting control plane.

**Status: built.** `astro-cms new <name> [--domain] [--port] [--image]` writes a site folder:
- **`compose.yaml`:**
  - Postgres 17 and the site, each with a health check;
  - the site published on loopback only, with an uploads volume;
  - optional Caddy with automatic HTTPS (`--profile tls`).
- **`.env`:** fresh secrets (a hex Postgres password, an `emdash_enc_v1_` key and a setup token). It's mode 600 and gitignored.
- **`backup.sh` and `restore.sh`:** `pg_dump --format=custom` plus a tarball of the uploads, with rotation.
- **A README:** start, claim, email and OAuth, backups and upgrades.

**F10 is solved by `@astro-cms/setup-guard`, not by pre-creating the admin.**
- **Why not pre-create:** core's passkey and OAuth paths also claim an unclaimed site. The OAuth callback grants Admin until setup is complete.
- **What the guard locks:** until setup completes, every setup and `/_emdash/api/auth/*` route needs the cookie from the setup link (`?setup_token=`), so the agency can use any sign-in method.
- **Live test 19/19 on a generated stack:**
  - the site becomes healthy, and is published on loopback only;
  - setup is locked to others (password, passkey, OAuth);
  - a wrong token gets nothing, and the link's cookie never contains the token;
  - claiming works, the guard is inert afterwards, and setup can't be repeated;
  - backup, then a change, then restore returns the earlier state.

**Still to do:**
- publishing the image to a registry (`ASTRO_CMS_IMAGE`);
- S3 media storage;
- off-server backup copy (left to the agency's tooling).

## 6. Upstream contributions

These shrink `@astro-cms/patches`. File issues first, then PRs.

| # | Issue | Our patch |
|---|---|---|
| 1 | Database config serialised at build time, so the documented `postgres({ connectionString: process.env.DATABASE_URL })` puts the password in `dist/` (F1). Propose an env-name option like migrations already have | `@astro-cms/runtime-config` (no patch) |
| 2 | SSRF guard requires Cloudflare DoH on Node (F11) | `patch-emdash.mjs` |
| 3 | OAuth credentials inlined at build time on Node (F18) | `patch-emdash.mjs` |
| 4 | Docs drift: policy `origin` shape, sandbox on Node, `/health`, `createPluginRuntimeTestHost`, `ca-certificates` (F8, F17) | none |
| 5 | Plugin scaffold pins stale `emdash`/`plugin-test` versions (F17) | none |
| 6 | Proposal: delete policy hook; publish scope separate from `content:write` (F16, F17) | v0.1 §5.4 patch |

## 7. Milestones

1. **Runtime config.** §5.1 and the patch package, plus issues 1–3 filed upstream.
2. **Migration.** §5.2 against theme unit test data, then a real client export (spike checklist 2b).
3. **Client auth completion.** §5.3: reset, 2FA, `astro-cms oauth`, and a Microsoft round trip.
4. **Agent safety.** §5.4 `agent-guard`, token profiles, the destructive-action patch, and a prompt-injection test (not yet tested, F15).
5. **Plugin kit and catalogue.** §5.6: `astro-cms plugin new`, the guide, then `cookie-consent` and `slider` (sitemap and SEO are core).
6. **Search and deployment.** §5.5, §5.7.
7. **Pilot.** One real client site migrated, handed over and edited by an agent for two weeks. The migration and deployment test is scripted in [`PILOT-PROMPT.md`](PILOT-PROMPT.md), a self-contained brief an agent on another host can run.

## 8. Open questions

- **Schema in Git.** Does a changed `seed.json` re-apply to an existing site (F6)? This decides whether "schema in Git, applied in CI" is ours to build.
- **Hostile plugins on Node.** Only the 30 s wall-time limit is enforced off Cloudflare (F17). This doesn't block v0.1, which runs first-party plugins only. It must be settled before a third-party catalogue opens (§5.6).

Decided (2026-10-27):
- One OAuth app per client site (§5.3).
- First-party plugins only in the MVP, with an authoring kit built for a future third-party catalogue (§5.6).
- **EmDash upgrade cadence.** Our patches fail loudly on drift. Who reviews upgrades, and how often?
- **Name and licence** of the distribution. MIT, to match EmDash?
