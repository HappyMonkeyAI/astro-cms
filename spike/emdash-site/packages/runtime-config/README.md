# @astro-cms/runtime-config

Postgres and local-storage adapters for EmDash on Node that read their settings from the environment **when the server starts**, so one image can serve every site.

## Why

EmDash serialises the `database` and `storage` config into `dist/` at build time:
- The documented `postgres({ connectionString: process.env.DATABASE_URL })` either writes the password into the build, or, if the variable is unset at build, silently drops it.
- The local storage directory is fixed at build time in the same way.

See `spike/README.md` F1 and F3.

## Usage

```js
import { localFromEnv, postgresFromEnv } from "@astro-cms/runtime-config";

emdash({
	database: postgresFromEnv(), // reads DATABASE_URL at server start
	storage: localFromEnv(), // reads UPLOADS_DIR at server start (default ./uploads)
});
```

| Option | Default | Description |
|---|---|---|
| `postgresFromEnv({ env, pool, ssl })` | `env: "DATABASE_URL"` | `pool` and `ssl` are non-secret and are serialised into the build |
| `localFromEnv({ env, defaultDirectory, baseUrl })` | `env: "UPLOADS_DIR"`, `defaultDirectory: "./uploads"` | Directory used when the variable is unset |

The server refuses to start the database if the variable is unset. The error names the variable, never its value.

## How it works

A descriptor's `entrypoint` names a module, which EmDash bundles and calls (`createDialect` / `createStorage`) when the server starts. Our modules resolve the environment at that moment, then delegate to `emdash/db/postgres` and `emdash/storage/local`. Migrations already read `DATABASE_URL` at runtime. No EmDash files are patched.

```bash
npm test
```
