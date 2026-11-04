---
kind: checkpoint
created: 2026-10-28T17:42:44Z
agent: cursor
sha: d4eeddb
branch: main
id: 2026-10-28T1742Z-ellis-pilot-on-devhost-completed-not-ready-repor
---
# Checkpoint: Ellis pilot on DevHost completed NOT READY; report written; site still up on pe…

## Summary

Ellis pilot on DevHost completed NOT READY; report written; site still up on peer :4500.

## Done

- Offloaded to dev-215 (Node 24, clone, client-data sync)
- Image build with all patches; compose site healthy
- Migrate + check; menus fixed to ellis-primary
- backup/restore OK
- pilot-report.md written and synced to desktop client-data

## Next

- Optional: re-export WXR before localhost URL rewrite and re-migrate
- Human/plugin path for CF7 leftovers
- User approve generic spike/README blurb

## Blockers

- NOT READY: CF7 shortcodes + localhost legacy URLs + 9 missing media
- Hermes mailbox worker never claimed gated tasks

## Decisions

- (none)
