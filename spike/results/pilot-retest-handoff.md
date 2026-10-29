# Developer handoff — pilot retest after F27/F29

**Date:** 2026-10-29 · **Peer HEAD:** `079d938` (includes F27/F29 on `main`) · **Verdict:** **NOT READY**  
**Why:** go-live check could not run — `migration-guard` scan failed with a forms-plugin unique-constraint error. Confidential detail: `client-data/pilot-out-retest/` (gitignored).

## What improved vs first pilot

| Area | First pilot | Retest |
|---|---|---|
| Legacy host | `localhost` only; media download 0 | `--production-url` rewrote **545** URLs (`http://localhost:8095` → live host); media import **74 downloaded**, 2 failed |
| Forms shortcodes | leftovers blocked go-live | Forms pass created **2** stand-in forms; **15/17** shortcodes replaced; **2** shortcode fixes failed |
| Menus | manual hyphen fix | Menus OK (6 written). Prepare hint still prints `--assign primary=<first-menu-slug>` (cosmetic; not the assigned value) |
| Backup/restore | pass | pass (392K db + 77M media) |
| Package tests | fail 0 | wp-migrate **57/57** |

## Blocker (new)

### 🔴 migration-guard scan × forms plugin storage

```
POST /plugins/migration-guard/scan -> 400
Bridge call storage/put failed:
duplicate key value violates unique constraint "uidx_plugin_emdash-forms_forms_slug"
```

- Happens during migrate’s go-live check (and standalone `check`).
- Message is misreported as “migration-guard isn't available”.
- Suspected: scan/storage path collides with forms already created by the forms pass (slug unique index), or guard tries to upsert a forms row.
- **Blocks verifying READY** even if content leftovers would otherwise be review-only.

## Remaining content / process leftovers

- **Forms to review (2):** stand-in contact forms because WXR lacked CF7 / WPForms definitions (`[contact-form-7 …]`, `[wpforms id=…]`). Notes also ask for notification recipients. Expected F29 “to review” path — human decision, not a crash.
- **Shortcodes:** 2 failed (investigate whether same missing-form cases).
- **Media:** 2 missing from download+uploads; media URL pass 5 unresolved / 6 failed.
- **Baseline:** 1 failed.
- **Local media step `ok: false`** only because 2 missing (74 already imported remotely — good F27 signal).

## Suggested next work

1. **Fix migration-guard ↔ forms storage collision** (or stop guard scan from writing forms slugs). Add a regression test: migrate with forms pass then `check` must not 400.
2. Clarify prepare’s `(site menu: --assign primary=…)` hint so operators don’t think the first menu was assigned.
3. Optional: when form definitions are absent from WXR, document that READY may still need human recipient + live-site compare (already in `forms-report.json`).

## How this was run

```text
DevHost: wipe pilot volumes → rebuild image → astro-cms new pilot
preflight/migrate with --production-url <live> --uploads … --assign primary=ellis-primary
```

Do not commit `client-data/`. Site left on DevHost `:4500` after restore.
