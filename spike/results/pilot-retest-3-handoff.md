# Developer handoff — pilot retest 3 (after F33)

**Date:** 2026-10-30 · **Peer HEAD:** `2ae4624` · **Run:** pull + image rebuild + recreate site container (no wipe, no re-migrate); go-live check only + URL diagnose + F33 agent safety  
**Verdict:** **NOT READY** (check exit 1) — same 2 content issues as retest 2. **F33 agent safety: PASS.**

Confidential logs: gitignored `client-data/pilot-out-retest-3/` (and prepared tree under `pilot-out-retest-2/`) on DevHost.

## Build / peer evidence

| Item | Result |
|---|---|
| `git pull` HEAD | `2ae4624` |
| Image rebuild | Build log contains `patched [F33 agents can't trash live content] node_modules/emdash/dist/astro/routes/api/mcp.mjs` |
| Site | Recreated from new image on existing `:4500` stack; no `-v` wipe; no re-migrate |
| Health | Site healthy; waited ~70s for plugin index sync before check |

## Go-live check

```text
NOT READY: 2 issue(s)
  - posts/<slug>: 2 legacy-host URL(s)
  - elementor_library/<slug>: 4 legacy-host URL(s)
```

`go-live.json`: `ready: false`, `scanned: 54`, `pendingDrafts: []`. Counts are **occurrences** in each entry (not always unique paths).

## Legacy / unresolved URL table

Domains redacted as `<live>` / `<localhost>`. Sources: `go-live.json` issues, `fix-media.json` unresolved, and `content_get` (markdown) on the two entries.

Occurrence note: go-live’s “2” on the post is the **same uploads URL twice**; fix-media lists that URL twice under unresolved. Distinct paths below = **5** (matches retest-2 “5 unresolved”).

| # | Source | Collection / type | Field | Redacted path | Kind | `$BASE` HTTP | In uploads copy? | In media library? |
|---|---|---|---|---|---|---|---|---|
| 1 | go-live + unresolved (×2) | `posts` / posts | content | `<live>/wp-content/uploads/2022/01/What-happens-during-a-mediation.mp3` | uploads file | 404 | no (exact path absent; a differently named/dated `.mp3` exists under `uploads/2022/02/`) | no |
| 2 | go-live + unresolved | `elementor_library` / elementor_library | content | `<live>/wp-content/plugins/seriously-simple-podcasting/assets/images/no-album-art.png` | plugin asset | 404 | n/a | n/a |
| 3 | go-live + unresolved | `elementor_library` / elementor_library | content | `<live>/wp-content/plugins/seriously-simple-podcasting/assets/css/images/player/images/icon-loader.svg` | plugin asset | 404 | n/a | n/a |
| 4 | unresolved (+ host frag in entry) | `elementor_library` / elementor_library | content | `<live>/podcast-player/3297/.mp3&t=What` | other (podcast player; mangled SSP-style URL) | 404 | n/a | n/a |
| 5 | unresolved (+ host frag in entry) | `elementor_library` / elementor_library | content | `<live>/podcast-player/3297/.mp3&url=What` | other (podcast player; mangled SSP-style URL) | 404 | n/a | n/a |

No `<localhost>` leftovers found in these two entries. No theme / wp-json / feed / normal internal page links in this set.

## F33 check (agent safety)

On the same `:4500` site:

1. `astro-cms agent create --name "Pilot check…" --expires 1d` (admin token) → agent-editor token issued.
2. As the agent over MCP:
   - `content_schedule` on a new draft → **rejected**, code **`SCHEDULE_REJECTED`**
   - `content_unpublish` on a published page (with `_rev`) → **rejected**, code **`UNPUBLISH_REJECTED`**
   - `content_delete` on that published page (with `_rev`) → **rejected**, code **`INSUFFICIENT_SCOPE`**
3. Public page status before/after: **200 / 200** (still live).
4. `astro-cms agent disable --id <id>` → OK; tokens cut off.

## Changed since retest 2

| Area | Retest 2 | Retest 3 |
|---|---|---|
| Peer HEAD | `0c43ce3` (F30/F31) | `2ae4624` (includes **F33**) |
| Site data | Fresh migrate | **Kept**; container recreated from new image only |
| Go-live | NOT READY, 2 legacy-host issues | **Same** 2 issues / same content leftovers |
| Agent trash/schedule/unpublish | Not verified on pilot host | **Verified PASS** with exact codes above |
| Media unresolved | 5 paths | **Same 5** distinct paths (diagnosed + HTTP-probed) |

Platform: F33 is live on the pilot image. Remaining NOT READY is still **content** (missing episode audio path + Elementor/SSP plugin & player URLs), not a new platform blocker from this rebuild.

## Suggested next (human / optional)

1. Replace or drop the post’s absolute `<live>` mp3 links (or import the matching file if the client still has `2022/01/…mp3`).
2. Clean Elementor podcast template: remove SSP plugin asset URLs and broken `/podcast-player/…` fragments (or re-author the player block for EmDash).
3. Form stand-ins / notification recipients unchanged from retest 2 (not re-checked here).
