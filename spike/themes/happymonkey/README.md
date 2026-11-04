# HappyMonkey EmDash theme overlay

Dogfood theme for [happymonkey.ai](https://happymonkey.ai): brand tokens, home layout blocks, projects/tools collections, and distinct routes. Built as image tag `astro-cms/site:happymonkey` so it does not replace `astro-cms/site:spike`.

## Layout

| Path | Role |
|------|------|
| `DESIGN.md` | Design tokens + rationale |
| `COMPOSITION.md` | Section order per route |
| `seed/seed.json` | Schema + seeded content (regenerate via `scripts/generate-seed.mjs`) |
| `src/styles/theme.css` | EmDash token overrides |
| `src/components/blocks/` | Hero, grids, contact, etc. |
| `src/pages/` | Home + projects routes |
| `astro.config.mjs` | Poppins + plugins |
| `scripts/prepare-build.sh` | Copy `spike/emdash-site` + overlay → `.build/` |

## Build

```sh
node spike/themes/happymonkey/scripts/generate-seed.mjs
bash spike/themes/happymonkey/scripts/prepare-build.sh   # or prepare-build.ps1
cd spike/themes/happymonkey/.build
docker build -t astro-cms/site:happymonkey .
```

Then `astro-cms new happymonkey --port 4510 --dir ~/sites` with `ASTRO_CMS_IMAGE=astro-cms/site:happymonkey`. Full agent brief: [DOGFOOD-PROMPT.md](../../../DOGFOOD-PROMPT.md).

## Rules

- Do not ship full-page HTML as a single template body.
- Keep `astro-cms/site:spike` for the WP client pilot.
- Cutover of live `happymonkey.ai` is a separate human gate.
