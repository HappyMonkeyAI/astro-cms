# @astro-cms/wp-migrate

WordPress → EmDash migration around EmDash's own WXR importer (SPEC §5.2). Passes are added one at a time; each has tests and an end-to-end check against the theme unit test data.

**One command** (a fresh EmDash site with `migration-guard`, plus an admin-scope API token):

```bash
EMDASH_TOKEN=… node src/cli.ts migrate export.xml --out ./out --base https://site --assign primary=main-menu --fetch-missing
# Old site offline, local or behind a firewall? Copy its wp-content/uploads folder and add:
#   --uploads ./uploads
```

It runs every step below in order, prints one line per step, writes `out/migrate-report.json`, and exits 0 only when the go-live check says the site is ready. On the theme unit test data this took 72 s on a fresh site, most of it media download.

The individual steps, for re-running one or debugging:

```bash
node src/cli.ts preflight export.xml              # report only; changes nothing
node src/cli.ts prepare export.xml --out ./out    # writes out/export.prepared.xml, preflight.json, shortcodes.json
# Import out/export.prepared.xml with EmDash, including media (e.g. spike/scripts/wp-import.mjs --out ./out/import)
EMDASH_TOKEN=… node src/cli.ts fix-shortcodes --prepared ./out --media ./out/import/4-media.json --base https://site
EMDASH_TOKEN=… node src/cli.ts fix-media --prepared ./out --media ./out/import/4-media.json --base https://site --fetch-missing
EMDASH_TOKEN=… node src/cli.ts redirects --prepared ./out --base https://site
EMDASH_TOKEN=… node src/cli.ts menus --prepared ./out --base https://site --assign primary=main-menu
EMDASH_TOKEN=… node src/cli.ts media-metadata --prepared ./out --media ./out/import/4-media.json --base https://site
EMDASH_TOKEN=… node src/cli.ts baseline --prepared ./out --base https://site      # after all edits
EMDASH_TOKEN=… node src/cli.ts check --prepared ./out --base https://site         # go-live check
```

Run the post-import commands in this order. Each writes a JSON report into `./out`, and each is safe to re-run.

The legacy hosts come from the export (`preflight.json`): the blog URL, the channel link and every attachment host. `wp:base_site_url` is excluded because on multisite and WordPress.com it's the network root.

Import `*.prepared.xml`, **never the original export**. `fix-shortcodes` needs an admin-scope API token. It writes through EmDash's MCP tools, so every change goes through the usual `_rev` check and appears in the revision history.

## Passes

| Pass | When | Status |
|---|---|---|
| **Rehost** (`--production-url https://<live site>`). An export taken from a staging copy after a search-replace names `localhost` (or another local host) everywhere; EmDash can't download media from it and every link to it is a leftover (spike F27). The live URL is put back first: plain, protocol-relative and JSON-escaped URLs, and PHP-serialized meta values with their lengths fixed. Without the option, preflight warns about any loopback, private or local-only legacy host | Before import | ✅ Done. Unit tests; not yet re-run on the client export |
| **Protected content.** Password-protected and private posts and pages become `draft`, so nothing WordPress kept from the public is ever published, even briefly. Listed in `preflight.json` for an editor to review | Before import | ✅ Done (spike F13 🔴). E2E: imported as draft, public URL 404, 55/58 other posts unchanged |
| **Shortcodes** (`[caption]`, `[gallery]`, `[audio]`, `[video]`, `[embed]`). See below | Before and after import | ✅ Done. E2E: 25/25 converted in 8 entries, 0 left in the database or on pages, 8/8 still published with their original dates, media served locally |
| **Forms** (Contact Form 7, WPForms, Jetpack). Each form becomes a form in EmDash's forms plugin (`@emdash-cms/plugin-forms`, which the site must have): fields, labels, required flags, choices, placeholders, length and file limits, the submit label, the thank-you message and the notification address. `[contact-form-7]` (by ID or 5.8+ hash), `[contact-form]` and `[wpforms]` shortcodes become `emdash-form` blocks. A shortcode whose form isn't in the export (page-only exports leave forms out) gets a standard contact form (name, email, message). Captchas give way to the plugin's honeypot. Everything that couldn't be carried over, and every form without a recipient, is listed in `forms-report.json` for an editor. Existing forms (by slug) are never overwritten | Before and after import | ✅ Done. Unit tests 6/6. Live (OceanWP demo): NOT READY → READY, submit, inbox, honeypot and notification e-mail all work (spike F29) |
| **Media URLs.** Every legacy media URL or reference in any field of any collection is pointed at the media library: image/gallery `asset` references (including leftover WP attachment-ID `_ref`s), size variants (`-150x150`), `?w=` resized URLs, cover backgrounds, file and embed URLs, embed HTML, image links and text links. `--fetch-missing` also downloads linked files the export didn't attach (on legacy hosts only, ≤ 50 MB) and uploads them. It then runs `media_usage_repair` | After import | ✅ Done. E2E: 169 → 0 legacy references (160 rewritten in 15 entries, 1 linked PDF fetched), 0 on public pages, all still published |
| **Local media** (`--uploads <copy of wp-content/uploads>`). For when the old host can't serve its media: offline, firewalled, a local or LAN site, which EmDash's SSRF guard blocks (upstream #3815). Every attachment the importer couldn't download is uploaded from the folder with `media_upload`. URLs map by their `/wp-content/uploads/…` path, or by a trailing `YYYY/MM/file` for WordPress.com and CDN URLs, and are confined to the folder. `fix-media` also takes linked non-attachment files from the folder first | After EmDash's media import | ✅ Done. E2E (OceanWP demo, stand-in folder): 27/27 uploaded and relinked |
| **Media metadata.** Alt text (`_wp_attachment_image_alt`) and captions (the attachment excerpt, tags stripped) are read from the export and written to the imported media items with `media_update`, matched by WordPress attachment ID. Only empty fields are filled, so an editor's alt or caption is never overwritten. Alt is never invented from the filename or title; the report counts images left without alt. EmDash media has no title field, so titles aren't restored | After import | ✅ Done. E2E: alt text 0/37 → 28/37 (all the export had), captions 0 → 21, 0 failed |
| **Non-ASCII slugs.** Percent-encoded post, category and tag slugs (`%ce%b5…`) are decoded. EmDash's importer stores them verbatim, which makes those entries unreachable at any URL (spike F21) | Before import | ✅ Done. E2E: Greek pages reachable |
| **Redirects and page hierarchy.** A 301 from each old permalink (date paths, nested `/parent/child/` page paths) to the new URL, using **EmDash core redirects** (group `wp-migrate`, idempotent). Internal links to old pages are rewritten to new URLs. Only published entries are redirected, so drafted protected content isn't reachable through its old URL | After import | ✅ Done. E2E: 76/76 old permalinks → 301 → 200, protected post 404 on old and new URLs, a re-run creates 0 |
| **Menus.** One EmDash menu per WordPress menu (slug → valid name, e.g. `all_pages`). Items link to the imported page, post or category, keeping nesting; custom links to old pages are rewritten. Items whose target isn't published are dropped, and their children move up a level, as WordPress does. `--assign primary=<wp-menu>` fills a site menu, since theme locations aren't in the export (the WordPress menu's slug, EmDash name or label) | After import | ✅ Done. E2E: 5 menus, 70/70 items, 0 dropped, idempotent; `primary` nav links all 200 |
| **Baseline revisions** (run last). EmDash's importer writes no revisions, so the first edit to a migrated entry can't be undone (spike F15). Every entry without history is re-saved unchanged, which snapshots it as a revision; published entries are re-published so the snapshot is live. Publish dates are kept, scheduled entries are never published, and entries with history are skipped | After import | ✅ Done. E2E: 60 → 0 entries without history, statuses and dates unchanged, re-run creates 0; an agent edit was undone by `revision_restore` |
| **Go-live check** (`check`, last step of `migrate`). It hands `migration-guard` the export's legacy hosts (saved, so its publish gate keeps blocking them), runs its scan, and looks for leftover shortcode markers. Ready means 0 issues (exit 0). Published entries with unpublished changes are listed for review but don't block: the scans read the live version, and the plugin refuses to publish leftovers. Issues in collections visitors can't reach (EmDash gives them no URL pattern, e.g. imported page-builder templates; or `routable: false`) are listed under `notPublic` for review, not blocking (F34). It fails closed: with no URL information at all, everything blocks | After import | ✅ Done. E2E: READY on the migrated site; a leftover planted in a published post → NOT READY (exit 1) naming it; restored → READY |

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
