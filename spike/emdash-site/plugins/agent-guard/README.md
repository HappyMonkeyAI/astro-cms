# agent-guard

Sandboxed EmDash plugin: AI agents can't publish on their own; an editor approves first.

- `content:beforePublish`: an MCP-origin publish by an actor below admin (role < 50, or no actor) is rejected and recorded as an approval request (one per entry; re-requests refresh it). All other origins and admin MCP actors pass.
- `content:beforeSchedule` / `content:beforeUnpublish`: refused outright for the same MCP actors (F33). A scheduled publish would go live without review, and unpublishing takes content off the site. No request is created; each refusal is audited as `refused`. Trashing live content is gated in the MCP tool by patch F33, because the delete hook has no actor.
- Admin page "Agent approvals" (editors and up): Approve (plugin publishes, fenced on the reviewed `_rev`) / Reject (draft untouched), plus recent decisions.
- Revision fence: the request stores `_rev` at request time. If the draft changed since, approval publishes nothing and the request becomes "stale"; the agent must publish again to re-open it for review.
- Audit: every policy decision and decision event goes to the `audit_log` storage.
- MCP tool `requests` (read-only). There is no approve tool.

```sh
npm install && npm run typecheck && npm test && npm run build
```
