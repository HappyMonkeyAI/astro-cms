# Draft upstream issues for emdash-cms/emdash

Status: **drafts for review, not filed.** Each was checked against existing issues on 2026-10-27; related ones are linked. Reproduced on emdash 1.3.1, Astro 7.4.2, `@astrojs/node` standalone, Node 24, Docker (`node:24-bookworm-slim`), Postgres 17.

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
