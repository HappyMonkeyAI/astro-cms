# @astro-cms/wp-migrate

WordPress → EmDash migration around EmDash's own WXR importer (SPEC §5.2). Passes are added one at a time; each has tests and an end-to-end check against the theme unit test data.

```bash
node src/cli.ts preflight export.xml              # report only; changes nothing
node src/cli.ts prepare export.xml --out ./out    # writes out/export.prepared.xml, preflight.json, shortcodes.json
# Import out/export.prepared.xml with EmDash, including media (e.g. spike/scripts/wp-import.mjs --out ./out/import)
EMDASH_TOKEN=… node src/cli.ts fix-shortcodes --prepared ./out --media ./out/import/4-media.json --base https://site
```

Import `*.prepared.xml`, **never the original export**. `fix-shortcodes` needs an admin-scope API token. It writes through EmDash's MCP tools, so every change goes through the usual `_rev` check and appears in the revision history.

## Passes

| Pass | When | Status |
|---|---|---|
| **Protected content.** Password-protected and private posts and pages become `draft`, so nothing WordPress kept from the public is ever published, even briefly. Listed in `preflight.json` for an editor to review | Before import | ✅ Done (spike F13 🔴). E2E: imported as draft, public URL 404, 55/58 other posts unchanged |
| **Shortcodes** (`[caption]`, `[gallery]`, `[audio]`, `[video]`, `[embed]`). See below | Before and after import | ✅ Done. E2E: 25/25 converted in 8 entries, 0 left in the database or on pages, 8/8 still published with their original dates, media served locally |
| Media URLs incl. size variants; media metadata | After import | Planned |
| Redirects and page hierarchy | After import | Planned |
| Menus | After import | Planned |
| Baseline revision per entry | After import | Planned |
| Final `migration-guard` scan = 0 | After import | Planned |

## How shortcodes are converted

Converting shortcodes to Gutenberg markup before import doesn't work. EmDash's converter switches the whole post to block mode, and the post's classic HTML then becomes raw `htmlBlock`s. Instead:

1. **`prepare`** parses shortcodes with a port of WordPress's own regex and attribute parser, so escaped `[[gallery]]` stays as text. It replaces each supported shortcode with a plain-text marker `{{wpm:<postId>:<n>}}`, which survives both of EmDash's conversion paths unchanged. It records what each marker stands for in `shortcodes.json`, with attachment IDs already resolved: `[gallery]` without `ids` uses the post's attached images by `menu_order`, as WordPress does.
2. **`fix-shortcodes`**, after import, reads each affected entry over MCP and splits text blocks at each marker, keeping formatting and links on both sides. It inserts `image` (with caption, alignment and link), `gallery` or `embed` (audio/video) blocks in the shapes EmDash's own converter produces. Media resolves to the new library by attachment ID, exact URL or size variant (`-300x200`). It writes each entry back with its `_rev`, and re-publishes it if it was published.

Shortcodes that can't be converted (unsupported names, a gallery with no images in the export) are left as text and listed by `preflight`, so `migration-guard` still blocks publishing them.

## Design

- No dependencies. `src/wxr.ts` edits the raw XML so a prepared file differs from the original only in the fields a pass changes.
- WordPress writes some fields plain and some as CDATA; reads accept both, and writes keep the original form.

```bash
npm test
```
