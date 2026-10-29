---
name: pilot-handoff
description: Respond to a pilot or test handoff pushed by the remote testing agent (spike/results/*-handoff.md). Covers pulling, reading and classifying the results, reproducing and fixing platform problems, recording findings, updating PROGRESS.md, and telling the pilot host what to re-run. Use when the user says the testing agent pushed results, a commit adds a file under spike/results/, or a pilot verdict needs acting on.
---

# Pilot handoff

The pilot runs on another host. An agent there follows [PILOT-PROMPT.md](../../../PILOT-PROMPT.md) on a real client export and pushes a handoff to `spike/results/` with a verdict (READY or NOT READY), what improved, the blockers and the leftovers. Confidential detail stays in its gitignored `client-data/` and never reaches the repo.

## 1. Pull and read

```bash
git fetch && git log --oneline HEAD..origin/main && git diff --stat HEAD origin/main
git pull --ff-only
```

Read the new handoff in full, along with any other files the commit touched; the remote agent sometimes adds its own tooling, such as `AGENTS.md` or `.cursor/`. Note the peer HEAD it ran on, so you know which fixes it already had.

## 2. Classify every item

| Kind | Meaning | Action |
|---|---|---|
| **Platform** | Our code, EmDash core or the image is wrong | Reproduce and fix, then record it as a finding |
| **Tooling UX** | It worked but misled the operator (wrong message, unclear hint) | Fix it; it's cheap and it's what pilots are for |
| **Content** | The export or uploads are incomplete or odd (missing files, stand-in forms) | Document it; a human or the client resolves it, so don't hack around it in code |
| **Process** | A step in PILOT-PROMPT.md was unclear or missing | Edit PILOT-PROMPT.md, usually a gotcha |

Blockers come first: anything that stops the go-live check from running hides every leftover behind it.

## 3. Reproduce before fixing

- Error text in the handoff is evidence, not a diagnosis. The remote agent's "suspected cause" can be wrong, and the message it quotes may be misreported (F30 was reported as "migration-guard isn't available").
- Read the real code path. EmDash's built code is under `spike/emdash-site/plugins/migration-guard/node_modules/emdash/dist`. Find the smallest reproduction, such as raw SQL in the compose Postgres or a unit test.
- Ask why the dev runs didn't catch it, such as a fresh site against one with existing data, or duplicate slugs. That gap is usually the missing regression test.
- Confirm the fix live on a throwaway site (the `throwaway-site` skill), using a fixture that triggers the condition. Never use client data in anything committed.

## 4. Record

- **`spike/README.md`:** add the next F-number under the matching section, with an emoji status (🔴 open, 🟢 resolved, 🔴→🟢 fixed), the cause, the symptoms, the fix and the evidence (test counts, live results). Link the handoff.
- **`spike/upstream-issues.md`:** when the bug is EmDash's, add a numbered draft (description, steps to reproduce, suggested fix, our workaround) and update the status line at the top.
- **`PROGRESS.md`:** add a dated section for the pilot run and each fix, with commit hashes; then update the milestone table and "Next".
- **Commits:** follow the repo style, e.g. `wp-migrate: … (F27)` or `Forms: … (F29)`. Stage only what you meant to commit, and check `git status` for `client-data` or secrets before committing.

## 5. Hand back

End with a short summary for the user:
- **Verdict**, and what improved since the last run, with numbers.
- **What was fixed**, and how it was verified.
- **What's left**, split between platform items and content or human items.
- **Exact instructions for the pilot host:** `git pull`, rebuild the image if the site, plugins or patches changed (a `wp-migrate`-only change doesn't need one), then re-run. Usually that means a fresh site with `--production-url <live URL>`, or re-running `check` on the site it left running.

Then propose one next step and wait for the go-ahead.
