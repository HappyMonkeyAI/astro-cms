# HappyMonkey composition brief

Section order and layout jobs per route. Maps Ellis “native kits” to EmDash Astro sections / block types.

## Home `/`

| Order | Section | Block / component | Content source |
|------:|---------|-------------------|----------------|
| 1 | Hero | `hero` | Site title/tagline + CTA links; muted looping header video + overlay (same asset as live site) |
| 2 | Credibility strip | `prose_band` (eyebrow only) | Short testing ethos line + stack names |
| 3 | Projects | `project_grid` | `projects` collection (featured) |
| 4 | Tools | `tool_strip` | `tools` collection |
| 5 | About | `prose_band` | Copy from live About |
| 6 | Latest insights | `insight_list` | Latest 3 `posts` |
| 7 | Contact | `cta_contact` | Email / phone / location + mailto |

One purpose per section. No stats strips, no promo chips on the hero.

## Projects

- **Index `/projects`:** heading + grid of all published projects (card layout).
- **Detail `/projects/{slug}`:** title, summary, optional image, body Portable Text, external URL CTA.

## Insights (posts)

- **Index `/posts` (nav label Insights):** list/rows with date + excerpt.
- **Detail `/posts/{slug}`:** article layout (meta + body). Comments off for dogfood.

## Legal pages `/pages/{slug}`

Simple Portable Text only (`privacy-policy`, `cookie-policy`, `terms-conditions`). No marketing blocks.

## Menus

- **primary:** Home, Projects, Insights, Contact (`/#contact` or `/#contact` hash on home).
- Footer links: Privacy, Cookies, Terms + mailto.

## Anti-patterns

- Do not paste homepage HTML into `index.astro` as a string.
- Do not use one layout for project detail and legal pages.
- Concept HTML under `work/` is review-only.
