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
| `@astro-cms/patches` | build script | Apply and verify EmDash patches; **fail the build** if a target string isn't found (detects upstream drift) | `patch-emdash.mjs`: F11, F18 |
| `@astro-cms/auth-password` | auth provider | Password setup, login, invite acceptance; later email-code 2FA and password reset | Built, 7 tests (F9, F20) |
| `@astro-cms/email-smtp` | native plugin | `email:deliver` via nodemailer, `SMTP_URL` read at send time | Built (F20) |
| `@astro-cms/pg-search` | native plugin | Postgres full-text search (tsvector + pg_trgm) to replace SQLite-only FTS | Not started (F2) |
| `migration-guard` | sandboxed plugin | Scan for WP leftovers, block publishing while they remain, issues admin page and MCP tools | Built, 6 tests (F16) |
| `agent-guard` | sandboxed plugin | Publish approval for agent-originated changes, audit log of agent actions | Not started (F15) |
| `redirects` | sandboxed plugin | Redirect table, admin page, MCP tools, 301s from old WP permalinks | Not started (F13) |
| `astro-cms` CLI | Node CLI | Site scaffolding, OAuth provisioning, `wp-migrate`, token management, upgrades | Scripts only (`spike/scripts/`) |

## 5. v0.1 scope (MVP)

Goal: **migrate one real client WordPress site and hand it over**, with the client signing in by Google or Microsoft and an agent doing routine edits safely.

### 5.1 Runtime configuration (blocks everything else)

- Patch the database config to resolve `DATABASE_URL` at runtime (F1). The storage directory and other serialised options get the same treatment (F3).
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
| Protected content | Password-protected posts become public (F13 🔴) | Import as **draft** and list them in the report. Never publish them automatically |
| Shortcodes | `[caption]`, `[gallery]`, `[audio]`, `[video]`, `[embed]` left raw | Convert to Portable Text blocks using WXR attachment data; report unknown shortcodes |
| Media URLs | Size variants and gallery/link URLs still point at the old host | Map `-WxH` variants and attachment URLs to the media library; rewrite in place |
| Media metadata | Alt text, captions, titles and attachment parents dropped (F15) | Restore from the WXR into the media items |
| Hierarchy and URLs | Child pages flattened, permalinks changed | Keep the WP path as each entry's slug path, or generate redirects |
| Redirects | Old permalinks 404 | Write every old URL → new URL into `redirects` |
| Menus | Not imported | Rebuild from `nav_menu_item` |
| Baseline revision | First agent edit to imported content can't be undone (F15) | Create a revision of every imported entry |
| Final gate | | `migration-guard` scan must report 0 issues before the site goes live |

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
- **Add:** a password reset screen and email-code 2FA in `auth-password`.
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

- **Token profiles in the CLI.** Named presets map to EmDash scopes:
  - `agent-editor`: `content:read`, `content:write`, `media:read`, `media:write`, `mcp:tools:migration-guard`
  - `agent-readonly`
  - Agency admins hold `admin` tokens. Agents never do.
- **Agent publish approval** (`agent-guard` plugin):
  - A `content:beforePublish` policy rejects `origin.source === "mcp"` publishes unless an editor approved them in the admin page.
  - Every attempt is logged (pattern proven in F16).
- **Destructive actions:**
  - There is no `beforeDelete` / permanent-delete hook (F16), and `content:write` includes permanent delete (F17).
  - v0.1 mitigation: a patch that refuses `content_permanent_delete` and `schema_delete_collection` for non-`admin` tokens.
  - Upstream: propose a delete policy hook.
- **Out of v0.1:**
  - block-level patch edits
  - discoverable block formats
  - scope-filtered `tools/list`
  - per-token actor IDs

  These are upstream proposals; F15 has the evidence.

### 5.5 Search

`pg-search` gives the site template's `/search` results on Postgres (F2).

### 5.6 Plugins: first-party catalogue and authoring kit

**Policy (decided 2026-10-27):**
- v0.1 runs **only our own plugins**.
- Building a plugin must be easy for us and for other developers from day one, so a third-party catalogue can open later without reworking anything.

**First-party catalogue.** Plugins WordPress clients expect, built on the `migration-guard` pattern (F16): sandboxed unless the plugin needs Node.

| Plugin | Notes |
|---|---|
| `cookie-consent` | Banner, consent categories and a consent log. Blocks analytics scripts until consent is given |
| `sitemap` | `sitemap.xml` and `robots.txt` from published content. First check whether EmDash core or `@astrojs/sitemap` already covers it |
| `slider` | A carousel block type with a site-side renderer and an admin editor. First check how plugins can contribute Portable Text block types and renderers |
| `redirects` | Already in §5.2 |
| `forms` | Contact form and submissions inbox, with email through `email-smtp`. Possibly v0.2 |
| `seo` | Per-entry title and description, plus Open Graph. First check what core already provides |

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

## 6. Upstream contributions

These shrink `@astro-cms/patches`. File issues first, then PRs.

| # | Issue | Our patch |
|---|---|---|
| 1 | Database config serialised at build time; password in `dist/` (F1) | v0.1 §5.1 |
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
5. **Plugin kit and catalogue.** §5.6: `astro-cms plugin new`, the guide, then `cookie-consent`, `sitemap` and `slider`.
6. **Search and deployment.** §5.5, §5.7.
7. **Pilot.** One real client site migrated, handed over and edited by an agent for two weeks.

## 8. Open questions

- **Schema in Git.** Does a changed `seed.json` re-apply to an existing site (F6)? This decides whether "schema in Git, applied in CI" is ours to build.
- **Hostile plugins on Node.** Only the 30 s wall-time limit is enforced off Cloudflare (F17). This doesn't block v0.1, which runs first-party plugins only. It must be settled before a third-party catalogue opens (§5.6).

Decided (2026-10-27):
- One OAuth app per client site (§5.3).
- First-party plugins only in the MVP, with an authoring kit built for a future third-party catalogue (§5.6).
- **EmDash upgrade cadence.** Our patches fail loudly on drift. Who reviews upgrades, and how often?
- **Name and licence** of the distribution. MIT, to match EmDash?
