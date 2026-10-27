# agent-guard

Sandboxed EmDash plugin: AI agents can't publish on their own; an editor approves first.

- `content:beforePublish`: an MCP-origin publish by an actor below admin (role < 50, or no actor) is rejected and recorded as an approval request (one per entry; re-requests refresh it). All other origins and admin MCP actors pass.
- Admin page "Agent approvals" (editors and up): Approve (plugin publishes, fenced on the reviewed `_rev`) / Reject (draft untouched), plus recent decisions.
- Revision fence: the request stores `_rev` at request time. If the draft changed since, approval publishes nothing and the request becomes "stale"; the agent must publish again to re-open it for review.
- Audit: every policy decision and decision event goes to the `audit_log` storage.
- MCP tool `requests` (read-only). There is no approve tool.

```sh
npm install && npm run typecheck && npm test && npm run build
```
