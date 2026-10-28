# @astro-cms/pg-search

Postgres full-text search for EmDash. EmDash's search is SQLite FTS5 only (spike finding F2). On Postgres, `search()`, `/_emdash/api/search`, `/_emdash/api/search/suggest` and the MCP `search` tool all returned nothing, and enabling search threw.

## How it plugs in

`scripts/patch-emdash.mjs` (F2) makes EmDash hand off to this package on Postgres:
- `searchWithDb`, `searchCollection` and `getSuggestions` call it;
- `enableSearch` and `disableSearch` record the collection's setting instead of throwing.

Nothing changes on SQLite. Templates keep calling `search()` from `emdash`.

**The runtime image needs `packages/pg-search`** (the Dockerfile copies it). EmDash's unbundled modules import it at runtime too.

## What it does

- **Builds the search document on the fly** for each query, as a weighted `tsvector` of the collection's searchable fields:
  - the title field gets weight A, and other fields weight C;
  - EmDash's `weights` config maps to the classes A–D;
  - Portable Text and JSON fields contribute every nested `text` value.
  - There's no index table to keep in sync, so results always match current content: publish, unpublish and trash take effect immediately.
- **Query syntax:**
  - Words match as prefixes, and all of them must match (`hel wor` finds "hello world").
  - `"quoted phrases"` match in order.
  - Visitor input is reduced to letters and digits, so tsquery syntax never passes through.
- **Snippets** come from `ts_headline`, with the same contract as EmDash: everything is HTML-escaped, and matches are wrapped in `<mark>`. Markup in content is dropped.
- **Results** have the same shape, cursors and ordering as EmDash's FTS5 path. Scores are `ts_rank × 100`.
- **Language:** set `PG_SEARCH_CONFIG` (`english` by default; also `simple`, `german`, and so on).

## Turning search on

New sites, and sites imported through EmDash's WordPress importer, enable search automatically (the seed and the importer call `enableSearch`).

For a site created before the patch:

```http
POST /_emdash/api/search/enable
{ "collection": "posts", "enabled": true }
```

This needs an admin session, or a token with the admin scope.

## Limits

**Cost grows linearly** with the number of published entries in the searched collections: about 0.5 ms per entry on the spike machine.
- 500 entries take about 270 ms.
- 6,000 entries took 3.2 s for a common word and 1.3 s for a rare one.

For large sites, the next step is a trigger-maintained `tsvector` table per collection with a GIN index.

## Tests

`npm test`: query building (including hostile input), weight mapping, snippet escaping and the config name.

The live test against Postgres (23 checks) is in the spike notes.
