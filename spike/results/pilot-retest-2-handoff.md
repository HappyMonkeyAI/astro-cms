# Developer handoff — pilot retest 2 (after F30 + F31)

**Date:** 2026-10-30 · **Peer HEAD:** `0c43ce3` · **Run:** fresh wipe + image rebuild + migrate  
**Verdict:** **NOT READY** (migrate exit 1, check exit 1) — **platform blockers from retest 1 are gone.**

Confidential logs: gitignored `client-data/pilot-out-retest-2/` on DevHost.

## Fixes confirmed

| Fix | Evidence |
|---|---|
| **F30** scoped plugin unique indexes | Build log: `patched [F30 scoped unique storage indexes (name)]` and `(where)`. Go-live **scan completed** (no `uidx_plugin_emdash-forms_forms_slug` / “guard isn't available”). |
| **F31** CPT collection names | Shortcodes: **17 replaced in 17 entries, 0 stuck, 0 failed** (was 15/17 with 2 `content_get` NOT_FOUND). |
| F27 `--production-url` | Still good: media import **74 downloaded**, 2 failed → local-media **2 missing**. |
| F29 forms | **2 created**, 0 failed; **2 toReview** (stand-ins). |

Also: menus 6 written / 0 failed; redirects 22; baseline 34 created / 0 failed; backup/restore OK; wp-migrate tests **63/63** before migrate.

## What improved vs retest 1

| Area | Retest 1 | Retest 2 |
|---|---|---|
| Go-live check | Crash (forms unique index) | Runs; reports content issues |
| Shortcodes | 15 replaced, **2 failed** | **17/17 replaced**, 0 failed |
| Media download | 74 | 74 (same) |
| Baseline | 1 failed | **0 failed** |
| Media URL rewrite failures | 6 failed | **0 failed** (5 unresolved remain) |

## Remaining leftovers (classified)

### Content / process — go-live issues (exact text)

From `go-live.json` / check output:

1. `collection=posts` — problem: **`2 legacy-host URL(s)`**
2. `collection=elementor_library` — problem: **`4 legacy-host URL(s)`**

`legacyHosts` still lists both `localhost` and the production host (expected after `--production-url`: old host kept so misses are caught). These two entries still contain URLs the guard treats as legacy.

### Content — forms toReview (exact notes)

1. Stand-in for missing CF7 definition:  
   `the export doesn't include this form ([contact-form-7 id="188" …]), so a standard contact form (name, email, message) stands in: compare it with the live site`  
   + `set who receives submissions (notifications)`
2. Stand-in for missing WPForms definition:  
   `the export doesn't include this form ([wpforms id="2865"]), so a standard contact form (name, email, message) stands in: compare it with the live site`  
   + `set who receives submissions (notifications)`

Go-live does **not** list the form stand-ins as blocking issues (shortcodes converted). Human review of recipients / live compare remains.

### Content — missing media (exact URLs from `local-media.json`)

1. `…/wp-content/uploads/woocommerce-placeholder.png`
2. `…/wp-content/uploads/2021/07/log_file_2021-07-26__13-06-46.txt`

Not in the uploads copy (and not downloadable as leftovers after import). Low impact (placeholder + log file).

### Tooling note (non-blocking)

Media URLs step: **5 unresolved**, 0 failed. Not listed in the 2 go-live issues above; worth a glance if unresolved items can become legacy-host hits on other entries later.

## Suggested next (human / optional product)

1. Human: open the two entries with legacy-host URLs; replace or remove leftover links (or extend rewrite if they are exotic encodings).
2. Human: set form notification recipients; compare stand-in forms to live.
3. Optional: ignore or fetch the two missing media files from the client if needed.
4. Platform: none required for READY from F30/F31 — remaining NOT READY is content.

## How run

```text
git pull → HEAD 0c43ce3
docker build (F30 patches present)
compose down -v; astro-cms new pilot; wait healthy + ~70s for index sync
migrate --production-url <live> --uploads … --assign primary=ellis-primary
→ client-data/pilot-out-retest-2/
```
