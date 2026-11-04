# Patterns and lessons — astro-cms

## HappyMonkey dogfood seed and CLI postgres gotchas

EmDash seed field slugs must be snake_case; camelCase fails validation and auto-seed looks like an empty site. emdash seed inside the site container defaults to SQLite /app/data.db even when DATABASE_URL is set — use first-request auto-seed with a valid seed, or admin API seed (remote-api-seed.mjs) against Postgres. REST create requires status=draft then POST /content/{collection}/{slug}/publish. HappyMonkey staging: astro-cms/site:happymonkey on 192.168.5.215:4510; live cutover deferred.

_cursor, 2026-11-03, 3857a12_
