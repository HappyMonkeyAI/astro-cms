# AGENTS.md — astro-cms

Behavior notes for agents working in this repo. Shared protocol law lives in [AgentsProtocol](https://github.com/HappyMonkeyAI/AgentsProtocol) (ADR-0005 Spine warm-start).

## Session start and end (Spine)
If the `spine` MCP is available, call `session_brief(project="astro-cms")` (or the absolute path of this repo) first and use `get_section` / `recall` instead of reading PROGRESS.md or CONTEXT.md whole. Without the MCP, run `spine brief` from the repo root. If neither works, ground normally.
Before you stop, call `checkpoint` with your agent name (e.g. `cursor`), what was done, what's next and any blockers. Save durable why/gotcha/decision facts with `record_memory`.

## Status and skills
[PROGRESS.md](PROGRESS.md) is the running status log; update it when you finish a piece of work. Repo skills live in `.claude/skills/` (plain Markdown, usable by any agent):
- `throwaway-site`: start, claim and remove throwaway sites for live tests (`site.sh up|down|list`).
- `pilot-handoff`: how pilot results in `spike/results/` are acted on, so write handoffs that fit it: verdict, peer HEAD, what improved, blockers with exact error text, leftovers.
