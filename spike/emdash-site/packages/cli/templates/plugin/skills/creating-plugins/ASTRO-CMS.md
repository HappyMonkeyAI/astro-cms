# astro-cms plugin lessons

Things we learned building `migration-guard` and `agent-guard` on EmDash 1.3.x. Where this file and the EmDash docs disagree, this file reflects what the runtime actually does.

## Runtime facts the docs get wrong

- **The policy-hook `event.origin` is an object**, `{ source: "api" | "mcp" | "visual-editor" | "plugin" | "scheduler" | "system", pluginId? }`, not a string. Code written from the docs logs `[object Object]`, and `origin === "mcp"` never matches. Use `event.origin.source`.
- **`event.actor` is the token *owner*,** `{ id, role, source }`, not the token. Two agents sharing one user can't be told apart. astro-cms gives every agent its own account (`astro-cms agent create`), so `actor.id` identifies the agent.
- **Sandboxed plugins run on Node too** (workerd child process). The `sandboxed` JSDoc saying "only on Cloudflare" is out of date.
- **Keep `@emdash-cms/plugin-test` at ^0.2.10.**
  - It exports `createPluginRuntimeTestHost()`; 0.1.x doesn't.
  - `plugin-cli init` used to pin `^0.1.0`, which bundles a plugin-cli 0.11 that rejects current capabilities.
  - Check its `index.d.mts` for the real API.

## Inputs and routes

- **Query-string values arrive as strings.** Use `z.coerce.number()` / `z.coerce.boolean()` for anything a GET might send.
- **Plugin routes are at `/_emdash/api/plugins/<slug>/<route>`.** Callers need the `X-EmDash-Request: 1` header (CSRF). Calls with no signed-in user get 401.
- **Tokens need the `admin` scope** for plugin routes without their own scope mapping, so an agent's editor token can't call your admin route. Still check `routeCtx.user.role` for anything that decides something.
- **Validate every input** and return `{ ok: false, error }` rather than throwing.

## Manifest and install

- **Admin page paths are `/` plus a name** (`/overview`, `/approvals`); a bare `/` fails validation.
- **Allow install scripts by package name** (`"workerd": true` in `allowScripts`), not by exact version. workerd releases every few days, and a stale exact pin makes npm 11 silently skip its postinstall, leaving the sandbox runtime broken.

## Storage and settings

- **Storage collection names must be snake_case** (`publish_log`, not `publishLog`); the manifest validator rejects anything else.
- **Use `ctx.settings` for configuration** an admin edits, and `ctx.storage` for records you query.

## Content and publishing

- **`ctx.content.get()` returns the live row.** Staged drafts of published entries live in revisions, so a scan of `content.list()` doesn't see pending edits.
- **For revision-fenced publishing,** read `_rev` with `ctx.content.getVersioned()` (needs `content:publish`), and pass it to `ctx.content.publish(collection, id, { _rev })`. If the draft changed, the host refuses with a conflict.
- **Publish policies that reject must never make a fix impossible.** `migration-guard` 0.2.0 allows a publish that is no worse than the live version; never-published entries stay strictly gated.

## Testing

- **`createPluginTestHost()`** is fast and good for hooks, routes and storage, but `seedContent()` takes plain field values (a `status` key is just a field), and there are no content actions. Code that calls `ctx.content.getVersioned` will fail there; catch it.
- **`createPluginRuntimeTestHost()`** has real content (`fixtures.content(collection, { slug, status: "published", data })`), real publishing (`actions.content.update/publish`), plugin settings (`fixtures.plugin.setting`), storage inspection (`inspect.storage.list`) and admin routes. Use it for anything involving published content or EmDash's real publish path. Always `dispose()` it.
- **Keep the plugin in a short path on Windows.** In a deep folder (a temp or scratch directory, ~170+ characters), vitest fails with "Timeout starting cloudflare-pool runner" after 90s, before any test runs. The same plugin passes in a short path such as `C:\Users\you\kt\my-plugin` or `plugins/<slug>` in the site repo.
- **Run `npm run check` before handing off.**

## Shipping it in the site image

- **workerd needs CA certificates:** the runtime image must install `ca-certificates` (our Dockerfile does), or every sandboxed call fails with "No CA certificates were loaded".
- **The site depends on the plugin with `file:plugins/<slug>`,** so the Dockerfile must build it and copy `dist`, `package.json` and `emdash-plugin.jsonc` into the runtime image (`node_modules/<slug>` is a symlink).
- **Plugin MCP tools** need an admin's consent (`PUT /_emdash/api/admin/plugins/<slug>/mcp {"enabled": true}`), and callers need the `mcp:tools:<slug>` scope. Never expose a tool that approves, publishes or deletes on an agent's behalf.
- **Don't create symlinks in the plugin folder;** they break on Windows checkouts.
