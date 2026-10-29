# Draft upstream issues for emdash-cms/emdash

Status: **drafts for review.** Drafts 1–3 are being filed by the user. Drafts 4–7 are new drafts for review and have not yet been checked against existing issues. Drafts 1–3 were checked against existing issues on 2026-10-27; related ones are linked. Reproduced on emdash 1.3.1, Astro 7.4.2, `@astrojs/node` standalone, Node 24, Docker (`node:24-bookworm-slim`), Postgres 17.

---

## 1. Postgres connection string is serialised into the build, so the documented config either leaks the password into `dist/` or silently drops it

**Labels:** bug, node, security

### Description

The documented Node + Postgres setup is:

```js
import { postgres } from "emdash/db";
emdash({ database: postgres({ connectionString: process.env.DATABASE_URL }) });
```

`astro.config.mjs` is evaluated at **build** time, and the integration serialises the whole descriptor (including `config.connectionString`) into `virtual:emdash/config` and from there into `dist/server/chunks/config_*.mjs`. `createDialect(config)` then uses that serialised value at runtime. As a result:

1. **`DATABASE_URL` is set at build** (CI, or a Docker build arg): the full connection string, password included, is written in plaintext into `dist/` and so into every image or artefact built from it.
2. **`DATABASE_URL` is set only at runtime** (the usual container/12-factor setup): the build sees `undefined` and the serialised config is `{}`, so the server silently connects to the `pg` defaults (`127.0.0.1:5432`). There's no warning.

Migrations don't have this problem: `postgres()` already records `manifestConfig: { connectionStringEnv: "DATABASE_URL" }`, and the migration runner reads the variable at runtime. Only the runtime dialect lacks the equivalent. `local({ directory })` storage has the same build-time behaviour (less sensitive, but uploads go to an unexpected directory). S3 storage already reads its env at runtime.

Related: #2139 (the same class of problem for `EMDASH_ENCRYPTION_KEY` et al.), #2453 (`process.env` ignored under Node adapters), #1688 (secret management).

### Steps to reproduce

1. Configure `database: postgres({ connectionString: process.env.DATABASE_URL })`.
2. `DATABASE_URL=postgres://user:s3cret@db:5432/app npm run build`, then `grep -rl s3cret dist/` → `dist/server/chunks/config_*.mjs`.
3. Alternatively, build without `DATABASE_URL`, run with it set → the server connects to `127.0.0.1:5432`, and the config chunk contains `"config": {}`.

### Suggested fix

Give `postgres()` the same env-name option that migrations already use, resolved inside `createDialect`:

```js
postgres({ connectionStringEnv: "DATABASE_URL" }) // value read from process.env when the dialect is created
```

and document it as the recommended form for Node, with `connectionString` only for non-secret or local use. Optionally warn at build when `connectionString` contains a password. The same `directoryEnv` option would suit `local()`.

### Workaround we use

Because the descriptor's `entrypoint` is honoured as-is, a wrapper entrypoint works with no patch: its `createDialect(config)` reads `process.env[config.connectionStringEnv]` and delegates to `emdash/db/postgres`'s `createDialect`. Verified: one image built with no env served two sites with different databases, and there were 0 secrets in `dist/`. Happy to turn this into a PR against `src/db/adapters.ts` / `src/db/postgres.ts` if the API shape is agreeable.

---

## 2. SSRF guard always resolves via Cloudflare DNS-over-HTTPS, so all outbound fetches fail on Node behind networks that block public DoH

**Labels:** bug, node, importer

### Description

The SSRF guard (`ssrf-*.mjs` in dist; `packages/core/src/security/ssrf.ts`) resolves every outbound hostname with:

```js
const resolver = options?.resolver ?? defaultResolver ?? cloudflareDohResolver;
```

On Node no `defaultResolver` is registered, so every server-side fetch to an external host does a DoH lookup against `https://cloudflare-dns.com/dns-query`, ignoring the system resolver. Corporate, on-prem and many filtered networks block or sinkhole public DoH endpoints (on our test network `cloudflare-dns.com` resolves to `0.0.0.0`). Every guarded fetch then fails with `SSRF_BLOCKED`.

The most visible effect is the WordPress importer: **37/37 media items failed**, and the admin UI showed only "Failed to import media", with nothing pointing at DNS. Any other guarded fetch is affected the same way.

This is distinct from #3815 (which asks for an override to allow private/local hosts). Here the targets are public hosts, and the guard can't resolve them at all.

### Steps to reproduce

1. Run on Node on a network where `cloudflare-dns.com` is unreachable or sinkholed (or simulate with a hosts entry `0.0.0.0 cloudflare-dns.com`).
2. Import a WXR whose media lives on a public host.
3. Every media item fails with `SSRF_BLOCKED`, while `curl` to the same URLs from the container works.

### Suggested fix

On Node, default to the system resolver (`node:dns/promises` `lookup(host, { all: true, verbatim: true })`) and keep the existing private/reserved-address validation on the resolved IPs. Keep DoH as the default only on Workers, where there's no system resolver. If DoH on Node is intentional (e.g. to avoid a poisoned local resolver), please make it configurable and surface the resolver failure in the import error.

### Workaround we use

A three-line patch to the line above that uses `node:dns/promises` when `process.versions.node` is set. Validation of the resolved addresses is unchanged. With it, 37/37 media imported. Happy to open a PR.

---

## 3. OAuth provider credentials are read from `import.meta.env`, so on Node they're inlined at build time and runtime env is ignored

**Labels:** bug, node, auth, security

### Description

The OAuth routes build their provider config from:

```js
// astro/routes/api/auth/oauth/[provider].ts and [provider]/callback.ts
getOAuthConfig(cfEnv ?? import.meta.env /* , ... */)
```

On Node there's no `cfEnv`, and Vite replaces the bare `import.meta.env` at build time with an object literal of the build environment. So:

1. **Credentials set only at runtime** (container env, the normal place for secrets) are ignored. `/_emdash/api/auth/oauth/google` redirects to the login page with `error=provider_not_configured` ("OAuth provider google is not configured").
2. **Credentials set at build time** work, but `EMDASH_OAUTH_*_CLIENT_SECRET` is written in plaintext into two files in `dist/` (the start and callback route chunks), and so into the image.

This looks like the same pattern #2139 fixed for `EMDASH_ENCRYPTION_KEY` and the other secrets in `secrets.ts`. The OAuth routes seem to have been missed by that fix.

### Steps to reproduce

1. Node adapter, `authProviders: [google()]`.
2. Build with no OAuth env, then run with `EMDASH_OAUTH_GOOGLE_CLIENT_ID`/`_SECRET` set → `provider_not_configured`.
3. Build with them set → `grep -rl <secret> dist/` finds the two OAuth route chunks.

### Suggested fix

Resolve OAuth credentials the same way #2139 resolved the other secrets: read from the runtime environment (`process.env` on Node, `cfEnv` on Workers) at request time, and don't read secrets through bare `import.meta.env`.

### Workaround we use

Patching both call sites to `getOAuthConfig(cfEnv ?? { ...import.meta.env, ...globalThis.process?.env })`. Runtime values then win, and nothing needs to be present at build. Verified with a real Google OAuth client: an invite accepted via Google and a repeat sign-in both worked, with 0 secrets in `dist/`. A proper fix should drop the `import.meta.env` read for secrets entirely, since our spread still inlines anything present at build. Happy to open a PR.

---

## 4. WXR importer keeps percent-encoded slugs, so entries with non-ASCII slugs are unreachable

**Labels:** bug, importer

### Description

WordPress stores non-ASCII slugs percent-encoded in WXR exports. The WordPress theme unit test data has a page with the Greek slug `επίπεδο-2`, exported as:

```xml
<wp:post_name>%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2</wp:post_name>
```

The importer stores this text verbatim, so `ec_pages.slug` holds `%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2` literally. Astro decodes the request path before the lookup, so the stored slug never matches. After import, `/pages/%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2` returns 404, and so do the upper-case-encoded form, a double-encoded form and the decoded form `/pages/επίπεδο-2`. The page exists in the database but cannot be reached at any URL.

EmDash itself serves Unicode slugs: renaming the imported page's slug to the decoded form made it reachable (see the steps below), so the problem is confined to the import path. Category and tag nicenames in the export are encoded the same way. We decode those too, but we have not separately confirmed that the taxonomy URLs fail in the same way.

### Steps to reproduce

1. Import the WordPress theme unit test data (it has a page with the slug `επίπεδο-2`), or edit the `wp:post_name` of any page in a WXR to the encoded form above.
2. After the import, check `ec_pages.slug`. It holds the encoded text.
3. Request `/pages/%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2`, the upper-case form `/pages/%CE%B5%CF%80%CE%AF%CF%80%CE%B5%CE%B4%CE%BF-2` and `/pages/επίπεδο-2`. All return 404.
4. Rename the slug to `επίπεδο-3` with MCP `content_update` (`slug: "επίπεδο-3"`), then publish. `/pages/επίπεδο-3` and `/pages/%CE%B5%CF%80%CE%AF%CF%80%CE%B5%CE%B4%CE%BF-3` then both return 200.

### Suggested fix

Decode `wp:post_name` during import, and the term nicenames (`wp:category_nicename`, `wp:tag_slug`, `wp:term_slug`, and `category/@nicename`) too, using `decodeURIComponent`. Fall back to the raw value if the escapes are not valid UTF-8. EmDash already serves Unicode slugs (step 4 above), so decoding on import should be enough and no runtime change should be needed.

### Our workaround

The wp-migrate package has a slugs pass that runs on the export before import. It decodes the slug elements that contain percent escapes and leaves every other value unchanged. Happy to open a PR.

---

## 5. Bug: WXR import finds 0 menus for exports that have no channel-level nav_menu term definitions

**Labels:** bug, importer, menus

### Description

On the WordPress theme unit test data, the WXR analysis step reports `menus=0`. The export contains 5 menus and 70 `nav_menu_item` posts. Each item is assigned to its menu with a post-level category element, `<category domain="nav_menu" nicename="...">`, and the export has no channel-level `<wp:term>` definitions for `nav_menu`. The export looks like a WordPress.com-style export. The importer has a `buildNavMenus()` that groups items by the `nav_menu` custom taxonomy.

**Observed:** the analysis reports zero menus, and after import the only menu on the site is the one from the seed data.

**Root cause: not verified.** Our hypothesis is that menus are built from the `<wp:term>` definitions, so a menu that has items but no definition is never created. We have not traced the code path to confirm this, and we have not tested an export where the definitions are present.

Menu names have a separate problem. EmDash menu names must match `/^[a-z][a-z0-9_]*$/`, but WordPress menu slugs commonly contain hyphens (for example `all-pages-flat`) and can contain non-ASCII characters. Any importer path that uses the WordPress slug as the menu name needs to normalise it.

### Steps to reproduce

1. Take the WordPress theme unit test data export (5 nav menus, 70 `nav_menu_item` posts, no `nav_menu` term definitions).
2. Run the WXR analysis step and observe `menus=0`.
3. Import the export and list the menus. Only the seed menu exists.

### Suggested fix

When there is no `<wp:term>` definition, build the menus from the `nav_menu` category assignments on the items. Use the `domain="nav_menu"` nicename as the key, and fall back to the slug as the label. For names, lowercase the slug, strip diacritics, replace each run of other characters with `_`, trim leading and trailing `_`, and prefix a letter when the name starts with a digit or is empty. Keep any fallback name unique, so that menus whose slugs contain no Latin letters do not collide.

### Our workaround

The wp-migrate package has a menus pass that reads the `nav_menu_item` posts directly from the export, groups them by menu slug, and resolves each target (entry, term or custom URL) to the new site's IDs. Items whose target is not published are dropped, and their children move up one level. The pass writes the menus through MCP, normalises the menu names as described above, and copies one menu into the template's `primary` location, because theme locations are not in the WXR.

---

## 6. Feature request: MCP tools for managing redirects

**Labels:** enhancement, mcp

### Description

EmDash core has a full redirect system. `/_emdash/api/redirects` supports create, list, update and delete, along with redirect groups and a 404 log. Redirects can be 301, 302, 307, 308, 410 or 451, and the system has pattern rules, hit counts and loop validation on write. An admin-scope PAT works against this API.

The MCP server (72 tools) has no redirect tools. An agent cannot list, create or fix a redirect, and it cannot read the 404 log to find broken links.

This matters most after a migration. A WXR import creates no redirects (0 after importing the WordPress theme unit test data), so old permalinks return 404. The only route we found for fixing this is calling the REST API directly with an admin-scope token, which sits outside the MCP permission model.

### Requested

- MCP tools for list, get, create, update and delete on redirects, and for reading the 404 log. Add groups if they are useful to agents. Mark delete as `destructive`, as the other tools are.
- A token scope such as `redirects:manage`, matching the existing `menus:manage` and `taxonomies:manage` scopes. That would let an agent manage redirects without an admin token.

### Our workaround

The wp-migrate package has a redirects pass that writes the old-permalink-to-new-URL map through the REST endpoint directly. On the theme unit test data it created 76 redirects, and all 76 old permalinks now return 301 and then 200. The same operations would let an agent manage redirects once they exist as MCP tools.

---

## 7. Plugin `uniqueIndexes` are not scoped to the plugin: they constrain every plugin's storage rows

**Labels:** bug, plugins, database

### Description

`generateCreateIndexSql` (src/plugins/storage-indexes.ts) builds a unique index as:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_plugin_<plugin>_<collection>_<field>"
  ON _plugin_storage(plugin_id, collection, (data::jsonb->>'<field>'))
```

There is no `WHERE plugin_id = '<plugin>' AND collection = '<collection>'`. Because `_plugin_storage` holds every plugin's rows, the uniqueness applies to all of them: any two rows in the same collection of *any* plugin that carry the same value in that JSON field now collide. Non-unique indexes have the same shape, which is only a size and performance cost, but for unique indexes it changes behaviour.

`@emdash-cms/plugin-forms` declares `uniqueIndexes: ["slug"]` on `forms`, so installing it breaks every other plugin that stores a `slug` field and has two rows with the same value. Common examples are an audit log that records the entry slug, or one record per entry when two collections contain the same slug.

### Steps to reproduce

1. Install `@emdash-cms/plugin-forms` on a fresh site (Postgres or SQLite).
2. In another plugin, `ctx.storage.log.put("a", { slug: "about" })`, then `put("b", { slug: "about" })`.
3. The second put fails: `duplicate key value violates unique constraint "uidx_plugin_emdash-forms_forms_slug"`.

On a site whose storage already has such rows, the reverse happens: the unique index can't be created, `syncDeclaredStorageIndexes` only logs `Failed to sync storage index …`, and the forms plugin's slug uniqueness is silently not enforced.

### Suggested fix

Make the unique index partial on both dialects (Postgres and SQLite both support partial indexes):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "<name>"
  ON _plugin_storage(plugin_id, collection, (<expr>))
  WHERE plugin_id = '<plugin>' AND collection = '<collection>'
```

Both values are already validated before interpolation. Existing sites need the unscoped index dropped and recreated. Changing the generated name, so the old one is removed as an orphan, does that for free.

### Our workaround

A build-time patch applies exactly that: partial unique indexes under a `suidx_` prefix. On an existing site, `removeOrphanedIndexes` then drops the old index. Our own plugin also stores the entry slug as `entrySlug`, so it no longer relies on other plugins' declarations.

