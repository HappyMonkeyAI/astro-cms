# Progress

Where astro-cms stands, newest first. Scope and decisions live in [SPEC.md](SPEC.md) and [CONTEXT.md](CONTEXT.md). Findings (F-numbers) are in [spike/README.md](spike/README.md), and upstream issue drafts in [spike/upstream-issues.md](spike/upstream-issues.md).

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Runtime config | Done. `@astro-cms/runtime-config`; one image serves many sites |
| 2 | Migration | Done. `wp-migrate` has every pass, a one-command `migrate` and a go-live `check` |
| 3 | Client auth | Done. Google OAuth round trip, password invite, reset and email 2FA, SMTP transport |
| 4 | Agent safety | Done apart from the prompt-injection test (F24) |
| 5 | Plugin kit and catalogue | Kit verified; cookie-consent and slider built; forms adopted from EmDash (F29) |
| 6 | Search and deployment | Done. pg-search (F2), `astro-cms new` recipe, setup-guard (F10) |
| 7 | Pilot | **In progress.** Real client export; the retest blocker (F30) is fixed, and the pilot host needs a rebuild and re-run |

## 2026-10-29

### Pilot, first run (`70d37cc`, handoff `spike/results/pilot-dev-handoff.md`)

A remote agent ran [PILOT-PROMPT.md](PILOT-PROMPT.md) on the real client export. The platform worked: image build, `astro-cms new`, setup lock, claim, migrate, and backup and restore (F28). Go-live was **NOT READY** because of the content:

- The export had been search-replaced to `localhost`, so no media downloaded.
- Contact-form shortcodes were left in page-builder templates.
- A few attachment files were missing from the uploads copy.

### F27: `--production-url` (`aec7c54`)

- `preflight`, `prepare` and `migrate` take `--production-url <live URL>`. It rewrites the export's own host to the live one, covering plain, protocol-relative and JSON-escaped URLs, and keeps PHP-serialized byte lengths correct.
- `preflight` warns when the export points at a private host (localhost, `.local`, `.test`, private IPs, and so on).
- `--assign` now matches menus by slug, label or normalised name, and an unknown menu lists the available slugs.

### F29: forms (`879334d`)

- We adopted EmDash's own `@emdash-cms/plugin-forms` (0.2.11) instead of building one. It has a builder, an inbox, notifications through our SMTP, a honeypot, and an `emdash-form` block.
- The `wp-migrate` forms pass converts Contact Form 7, WPForms and Jetpack forms, and their shortcodes become form blocks. A shortcode whose form isn't in the export gets a standard contact form, flagged for review in `forms-report.json`.
- On the OceanWP lawyer demo the live test passed 12/12, and the result went from NOT READY to READY TO GO LIVE.

### Pilot retest (`7c77a72`, handoff `spike/results/pilot-retest-handoff.md`)

- **What improved:** `--production-url` rewrote 545 URLs and 74 media files downloaded. The forms pass created 2 stand-in forms and replaced 15 of 17 shortcodes.
- **What blocked it:** the go-live check couldn't run. The migration-guard scan failed with a unique-constraint error from the forms plugin.

### F30: plugin unique indexes leak across plugins

- **Cause:** a bug in EmDash core. A plugin's `uniqueIndexes` become an index on the whole shared `_plugin_storage` table, with no `WHERE` clause. So the forms plugin's unique `slug` rule constrains every plugin's rows.
- **Symptoms:**
  - On a fresh site, migration-guard writes fail when two entries share a slug.
  - On an existing site, the index silently fails to build, and form slugs aren't really unique.
- **Fixes:**
  - **EmDash patch** in `scripts/patch-emdash.mjs`: unique indexes become partial and scoped to their own plugin and collection, under a new `suidx_` name. The old index is then dropped as an orphan. Upstream draft 7.
  - **migration-guard:** stores `entrySlug` instead of `slug`.
  - **Go-live check:** reports a scan error as a scan failure. Only a 404 means the plugin is missing.
  - **`prepare`:** clearer `--assign` hint.
- **Verified so far:**
  - reproduced in Postgres, and the scoped index fixes it;
  - the patch applies to emdash 1.3.1;
  - `wp-migrate` 59/59 (2 new regression tests);
  - migration-guard 9/9.
- **Live test in the rebuilt image: 12/12.** It covered the existing-site path, dropping the old index, a migrate with a page and a post sharing a slug, and that form slugs stay unique.
- **Timing:** plugin storage indexes are synced on the first scheduler tick, about a minute after boot.

### Repo skills

- `.claude/skills/throwaway-site`: `site.sh up|down|list` for claimed throwaway test sites. It was used by the F30 live test.
- `.claude/skills/pilot-handoff`: how to act on pilot results.
- AGENTS.md points other agents at both skills and at this file.

## Next

1. Pilot host: `git pull`, rebuild the image, and run the go-live check again on the site left on `:4500`. A fresh re-run also works.
2. Look into the retest's 2 failed shortcode fixes (probably the missing-form case) and the 2 missing media files.
3. Pilot content review needs a human: compare the 2 stand-in forms with the live site, set notification recipients, and get a complete uploads copy from the client.

## Open, not scheduled

- Publish the site image to a registry.
- S3 media storage.
- A cookie consent log.
- A pg-search index table.
- The prompt-injection test (F24).
- The Microsoft SSO round trip.
- A 2FA toggle.
- Browser click tests for cookie-consent and slider, and the slider's admin modal flow.
- Check the forms plugin's admin builder in a browser.
- Upstream drafts: 1–3 are being filed by the user; 4–7 are for review.
- Remove the leftover worktree folder, and enable search on the main site at `:4321`.

## Gotchas

- Site image builds take 10–20 minutes on the dev machine, and memory gets tight.
- The compose service is `emdash`, not `site`.
- Keep generated plugins in short Windows paths, or vitest's workerd pool times out.
- `setup-guard` must be listed before `emdash()` in `astro.config.mjs`.
- `client-data/` is gitignored and must never be committed. Keep client names and domains out of findings and handoffs.
