# Developer handoff — milestone 7 pilot (real client WXR)

**Date:** 2026-10-28 · **Repo:** `d4eeddb` · **Verdict:** **NOT READY** (migrate exit 1, go-live check exit 1)  
**Runner:** DevHost `dev-215` (desktop RAM was critical; Hermes mailbox worker did not claim the gated task — executed via SSH following `PILOT-PROMPT.md`).  
**Confidential detail:** full timed checklist and leftovers live only in gitignored `client-data/pilot-report.md`. This file is safe for commits and agent inboxes.

## What passed

- All listed package tests: `fail 0`.
- Image build: every required patch line present (F11, F18, SPEC 5.4 ×6 tools, F2 ×6); no `did not apply`.
- SETUP_LOCKED → 403 once the **site** container is healthy.
- Claim + admin password login + admin API token.
- Import: dozens of entries; redirects created; baseline revisions created.
- `--uploads` recovered most media when remote fetch failed (F11 path).
- Menus: five WP menus written; site `primary` assign works when slug matches preflight exactly.
- `backup.sh` / `restore.sh`: OK (DB + media stamp restore, site comes back).
- migration-guard correctly kept go-live **NOT READY** for leftovers (F16/F23 behaviour).

## Go-live leftovers (classified)

| Class | What | Suggested owner |
|---|---|---|
| Needs plugin / product | Unsupported form shortcodes in page-builder **library** templates | Forms plugin or human rebuild; keep guard blocking |
| Process / docs | WXR exported from staging **after** production→localhost search-replace → preflight `legacy hosts: localhost`; media import 0 downloaded; residual localhost URLs on a few entries | Document export-before-rewrite; optional WXR host rewrite helper |
| Human / data | A small number of attachment files missing from the uploads copy | Agency ops / incomplete backup |
| Operator | `--assign primary=<slug>` must use the **exact** preflight slug (hyphens ≠ underscores) | Docs / CLI tip in preflight output |

## Proposed findings (for `spike/README.md` — do not invent client names)

### F27 🟠 Pilot: WXR from a URL-rewritten staging dump reports legacy host `localhost`

- Preflight lists `legacy hosts: localhost`. EmDash media download fails (SSRF / non-public); `--uploads` is required.
- Leftover localhost URLs can remain in content and fail go-live check.
- **Repro:** restore WP backup → search-replace live URL to `http://localhost:…` → `wp export` → `wp-migrate migrate`.
- **Fix options:** (1) document “export before rewrite”; (2) add a prepare/preflight warning when legacy host is loopback/private; (3) optional `--legacy-host=` override when using `--uploads` only.

### F28 🟢 Pilot: deployment recipe holds for a real export

- Patched image, `astro-cms new`, claim lock, migrate pipeline, backup/restore all runnable on a fresh Linux host with Node 24 + Docker.
- Checklist gaps in the automated pass: search UI and cookie-banner UX were not exercised; spot-check vs live WP was not done.

### Doc nits (no new F needed)

- Setup unlock URL is `/_emdash/admin?setup_token=…` (CLI already prints this). Automation that invents `/_emdash/setup/<token>` gets 404.
- Health wait must target the **site** service (`docker compose ps site`), not any `(healthy)` line (DB becomes healthy first).

## Suggested `spike/README.md` checklist update

| # | Test | Status |
|---|---|---|
| 2b | WordPress import: a real client WXR export | ✅ Done (2026-10-28). **NOT READY** go-live: form shortcodes + staging-localhost legacy URLs. Handoff: `results/pilot-dev-handoff.md`. Confidential report: `client-data/pilot-report.md`. |

## Suggested next work (priority)

1. **Docs / preflight:** warn when legacy host is loopback or private; point at `--uploads` and export-before-rewrite.
2. **Optional tool:** `wp-migrate` flag or prepare step to rewrite legacy hosts in the prepared WXR when the operator knows production host + has local uploads.
3. **Product gap (known F23):** contact-form shortcodes — plugin or migration guidance for library templates.
4. **Pilot script polish:** fold SETUP_LOCKED wait-on-site and exact menu-slug tip into `PILOT-PROMPT.md` gotchas.
5. **Ops:** Hermes gated worker on DevHost did not claim tasks — separate from astro-cms product, but blocks “agent on another host” story in the prompt.

## Out of scope for the developer agent

- Do not commit anything under `client-data/`.
- Do not paste client copy, domains, or credentials into issues/PRs.
- Do not “fix” go-live by deleting leftover entries unless the user asks.

## Where to look

- Brief: `PILOT-PROMPT.md`
- Confidential report: `client-data/pilot-report.md`
- Peer site (if still up): DevHost `/home/stephen/sites/pilot` → `127.0.0.1:4500` (tunnel from desktop if needed)
- Commit tested: `d4eeddb`
