# Context

## Why this exists

Clients like WordPress's mental model: posts, pages, menus, a media library and an admin they recognise. Developers dislike its PHP legacy, the plugin security record and the maintenance load. Agencies want to ship client sites faster and let AI agents do routine content work safely.

## Product thesis

An **agent-native, self-hosted CMS distribution for agencies**, built on Astro and TypeScript, that runs anywhere on Node and gives WordPress sites a credible migration path.

Working hypothesis (pending the spike below): build **on top of EmDash** (MIT, Cloudflare, v1.3.x as of 2026-10) rather than writing a new CMS core. Our product would be the Node-first, agency-grade layer that EmDash treats as second-class.

## Audiences

1. **Our own clients.** We upsell new sites and migrations from WordPress, and offer agent-assisted content management.
2. **Other developers and agencies.** They adopt the open core the way they adopted WordPress, and pay for hosting, premium blocks, migration tooling and support.

## Business model (open core)

- **Free:** the distribution, Docker/Postgres deployment recipes, and fixes contributed upstream.
- **Paid:**
  - managed Node hosting
  - a visual page-builder plugin
  - premium blocks, including 3D/spatial blocks from astro-spatial
  - a migration service and enhanced migration tooling
  - agency features: client management, custom roles, schema in Git
  - support licences

## Where EmDash leaves room (from research, 2026-10-25)

| Gap | Our answer |
|---|---|
| Node/Postgres is second-class: plugin limits aren't enforced off Cloudflare, search is fragile, Postgres bugs keep appearing | A tested Node + Postgres distribution with working search and supported Docker deployment |
| Schema lives in the database (admin UI or `seed.json`), not in code | Schema in Git, applied in CI, reviewed like any other code |
| Form-based editing only, no visual building | Visual/voice page builder (from voice-page-builder) as an admin plugin |
| WordPress migration gaps: shortcodes, server-rendered blocks, redirects, scheduled posts, resumable imports | Enhanced importer and redirect map |
| Five fixed roles, no multi-site or agency client management | Custom roles and an agency console |
| No theme registry, no paid plugins yet | Themes and premium plugins |

We do **not** compete on what EmDash already does well: its MCP server (72 tools, OAuth 2.1, role-intersected scopes), Portable Text, revisions, i18n and the core admin.

## Prior work to reuse

- **HappyMonkeyAI/astro-spatial:**
  - a validated manifest as the single contract
  - stable IDs as public contracts
  - change records with undo/redo
  - a component registry that generates `llms.txt`, with a staleness check
  - diagnostic codes
  - asset provenance
- **voice-page-builder:** Page → Sections → Elements, with agents returning structured mutations, and versions stored as snapshots plus changelogs.
- **ai-site-builder:** a manager/component/assembly/verifier pipeline. Here it becomes "generate a site from a brief" for onboarding and sales demos.
- **restaurantMarketingAgent:** lead discovery, at the top of the funnel.

## Constraints

- Runs anywhere on Node. Nothing in our layer may require Cloudflare.
- Our differentiators touch EmDash only through thin adapters. EmDash's MIT licence keeps forking available as a last resort.
- Content edits by agents must be scoped, attributable and reversible.
- Stay far smaller than WordPress. Every feature has to justify itself against the MVP boundary.

## Decision gate: the EmDash spike

Before we commit, test EmDash hands-on (see `spike/README.md`):

1. Run it on Node + Postgres in Docker.
2. Import WordPress content (theme unit test data, then a real client export) and record what breaks.
3. Drive it through MCP with Claude on realistic editing tasks.
4. Write a trivial plugin and admin page to judge how extensible it is.

**If it passes:** write `SPEC.md` for the distribution. **If it fails:** the evidence justifies building our own core, and this document still applies apart from the "build on EmDash" hypothesis.

## Main risks

- Depending on Cloudflare's roadmap and a small maintainer team. Mitigation: thin adapters, upstream contributions, fork as a last resort.
- Scope creep. astro-spatial's lesson was to go deep on the core before going wide.
- EmDash's ecosystem may never reach critical mass. Mitigation: our client work is the first market, so we don't depend on an ecosystem.
