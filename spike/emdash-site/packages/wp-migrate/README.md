# @astro-cms/wp-migrate

WordPress → EmDash migration around EmDash's own WXR importer (SPEC §5.2). Passes are added one at a time; each has tests and an end-to-end check against the theme unit test data.

```bash
node src/cli.ts preflight export.xml              # report only; changes nothing
node src/cli.ts prepare export.xml --out ./out    # writes out/export.prepared.xml + out/preflight.json
```

Import `*.prepared.xml`, **never the original export**. For example, use `spike/scripts/wp-import.mjs`.

## Passes

| Pass | When | Status |
|---|---|---|
| **Protected content.** Password-protected and private posts and pages become `draft`, so nothing WordPress kept from the public is ever published, even briefly. Listed in `preflight.json` for an editor to review | Before import | ✅ Done (spike F13 🔴). E2E: imported as draft, public URL 404, 55/58 other posts unchanged |
| Shortcodes (`[caption]`, `[gallery]`, `[audio]`, …) | Before import | Next |
| Media URLs incl. size variants; media metadata | After import | Planned |
| Redirects and page hierarchy | After import | Planned |
| Menus | After import | Planned |
| Baseline revision per entry | After import | Planned |
| Final `migration-guard` scan = 0 | After import | Planned |

## Design

- No dependencies. `src/wxr.ts` edits the raw XML so a prepared file differs from the original only in the fields a pass changes.
- WordPress writes some fields plain and some as CDATA; reads accept both, and writes keep the original form.

```bash
npm test
```
