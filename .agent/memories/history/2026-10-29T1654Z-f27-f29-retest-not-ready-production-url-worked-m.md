---
kind: checkpoint
created: 2026-10-29T16:54:39Z
agent: cursor
sha: 079d938
branch: main
id: 2026-10-29T1654Z-f27-f29-retest-not-ready-production-url-worked-m
---
# Checkpoint: F27/F29 retest NOT READY: production-url worked; migration-guard×forms unique c…

## Summary

F27/F29 retest NOT READY: production-url worked; migration-guard×forms unique constraint blocks check.

## Done

- Retest on DevHost with --production-url
- Wrote spike/results/pilot-retest-handoff.md
- Messaged dev-agent with blocker

## Next

- Dev: fix migration-guard scan vs forms slug unique index
- Optional commit of pilot-retest-handoff.md

## Blockers

- go-live check 400 duplicate key uidx_plugin_emdash-forms_forms_slug

## Decisions

- (none)
