# Developer handoff — pilot retest 4 (after F34)

**Date:** 2026-10-30 · **Peer HEAD:** `3f9ea24` · **Run:** `git pull` only; re-ran go-live **check** on existing `:4500` site (no rebuild, no re-migrate)  
**Verdict:** **NOT READY** (check exit 1) — **1 blocking issue** (blog post `.mp3` legacy-host URLs). Elementor template moved to **to review** (not blocking). **F34 confirmed on the real pilot site.**

Confidential logs: gitignored `client-data/pilot-out-retest-4/` on DevHost.

## Check output (redacted)

```text
NOT READY: 1 issue(s)
  - posts/<slug>: 2 legacy-host URL(s)
1 issue(s) in collections with no public URL, to review (not blocking; visitors can't reach them):
  - elementor_library/<slug>: 4 legacy-host URL(s)
```

`go-live.json` (hosts redacted): `ready: false`, `scanned: 56`, `pendingDrafts: []`.

| List | Collection | Problem |
|---|---|---|
| **issues** (blocking) | `posts` | `2 legacy-host URL(s)` — same absolute `<live>/wp-content/uploads/2022/01/….mp3` twice (see retest 3) |
| **notPublic** (to review) | `elementor_library` | `4 legacy-host URL(s)` — SSP plugin assets + mangled podcast-player fragments |

## Changed since retest 3

| Area | Retest 3 | Retest 4 |
|---|---|---|
| HEAD | `2ae4624` (F33) | `3f9ea24` (F34) |
| Site / image | Recreated for F33 | **Unchanged** (check-only; F34 is wp-migrate CLI on host) |
| Blocking issues | 2 (post + elementor) | **1** (post only) |
| Elementor template | Blocked go-live | **to review** via `notPublic` |
| F33 agent safety | PASS | Not re-run |

## Leftovers before go-live (human / client — not code)

1. **`.mp3` link** on the published post: supply the file or update/remove the absolute `<live>` URLs (only remaining go-live blocker).
2. **Two form stand-ins:** set submission recipients; compare with the live site (unchanged since retest 2).
3. **Two missing media files** (placeholder image + log file): can probably ignore.
