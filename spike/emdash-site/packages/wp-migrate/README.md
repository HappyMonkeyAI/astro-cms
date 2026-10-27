# @astro-cms/wp-migrate

WordPress → EmDash migration around EmDash's own WXR importer (SPEC §5.2). Passes are added one at a time; each has tests and an end-to-end check against the theme unit test data.

```bash
node src/cli.ts preflight export.xml              # report only; changes nothing
node src/cli.ts prepare export.xml --out ./out    # writes out/export.prepared.xml, preflight.json, shortcodes.json
# Import out/export.prepared.xml with EmDash, including media (e.g. spike/scripts/wp-import.mjs --out ./out/import)
EMDASH_TOKEN=… node src/cli.ts fix-shortcodes --prepared ./out --media ./out/import/4-media.json --base https://site
EMDASH_TOKEN=… node src/cli.ts fix-media --prepared ./out --media ./out/import/4-media.json --base https://site --fetch-missing
EMDASH_TOKEN=… node src/cli.ts redirects --prepared ./out --base https://site
EMDASH_TOKEN=… node src/cli.ts menus --prepared ./out --base https://site --assign primary=main-menu
EMDASH_TOKEN=… node src/cli.ts media-metadata --prepared ./out --media ./out/import/4-media.json --base https://site
EMDASH_TOKEN=… node src/cli.ts baseline --prepared ./out --base https://site      # always last
```

Run the post-import commands in this order. Each writes a JSON report into `./out`, and each is safe to re-run.

The legacy hosts come from the export (`preflight.json`): the blog URL, the channel link and every attachment host. `wp:base_site_url` is excluded because on multisite and WordPress.com it's the network root.

Import `*.prepared.xml`, **never the original export**. `fix-shortcodes` needs an admin-scope API token. It writes through EmDash's MCP tools, so every change goes through the usual `_rev` check and appears in the revision history.

## Passes

| Pass | When | Status |
|---|---|---|
| **Protected content.** Password-protected and private posts and pages become `draft`, so nothing WordPress kept from the public is ever published, even briefly. Listed in `preflight.json` for an editor to review | Before import | ✅ Done (spike F13 🔴). E2E: imported as draft, public URL 404, 55/58 other posts unchanged |
| **Shortcodes** (`[caption]`, `[gallery]`, `[audio]`, `[video]`, `[embed]`). See below | Before and after import | ✅ Done. E2E: 25/25 converted in 8 entries, 0 left in the database or on pages, 8/8 still published with their original dates, media served locally |
| **Media URLs.** Every legacy media URL or reference in any field of any collection is pointed at the media library: image/gallery `asset` references (including leftover WP attachment-ID `_ref`s), size variants (`-150x150`), `?w=` resized URLs, cover backgrounds, file and embed URLs, embed HTML, image links and text links. `--fetch-missing` also downloads linked files the export didn't attach (on legacy hosts only, ≤ 50 MB) and uploads them. It then runs `media_usage_repair` | After import | ✅ Done. E2E: 169 → 0 legacy references (160 rewritten in 15 entries, 1 linked PDF fetched), 0 on public pages, all still published |
| **Media metadata.** Alt text (`_wp_attachment_image_alt`) and captions (the attachment excerpt, tags stripped) are read from the export and written to the imported media items with `media_update`, matched by WordPress attachment ID. Only empty fields are filled, so an editor's alt or caption is never overwritten. Alt is never invented from the filename or title; the report counts images left without alt. EmDash media has no title field, so titles aren't restored | After import | ✅ Done. E2E: alt text 0/37 → 28/37 (all the export had), captions 0 → 21, 0 failed |
| **Non-ASCII slugs.** Percent-encoded post, category and tag slugs (`%ce%b5…`) are decoded. EmDash's importer stores them verbatim, which makes those entries unreachable at any URL (spike F21) | Before import | ✅ Done. E2E: Greek pages reachable |
| **Redirects and page hierarchy.** A 301 from each old permalink (date paths, nested `/parent/child/` page paths) to the new URL, using **EmDash core redirects** (group `wp-migrate`, idempotent). Internal links to old pages are rewritten to new URLs. Only published entries are redirected, so drafted protected content isn't reachable through its old URL | After import | ✅ Done. E2E: 76/76 old permalinks → 301 → 200, protected post 404 on old and new URLs, a re-run creates 0 |
| **Menus.** One EmDash menu per WordPress menu (slug → valid name, e.g. `all_pages`). Items link to the imported page, post or category, keeping nesting; custom links to old pages are rewritten. Items whose target isn't published are dropped, and their children move up a level, as WordPress does. `--assign primary=<wp-menu>` fills a site menu, since theme locations aren't in the export | After import | ✅ Done. E2E: 5 menus, 70/70 items, 0 dropped, idempotent; `primary` nav links all 200 |
| **Baseline revisions** (run last). EmDash's importer writes no revisions, so the first edit to a migrated entry can't be undone (spike F15). Every entry without history is re-saved unchanged, which snapshots it as a revision; published entries are re-published so the snapshot is live. Publish dates are kept, scheduled entries are never published, and entries with history are skipped | After import | ✅ Done. E2E: 60 → 0 entries without history, statuses and dates unchanged, re-run creates 0; an agent edit was undone by `revision_restore` |
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
