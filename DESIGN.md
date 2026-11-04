---
version: alpha
name: HappyMonkey EmDash
description: Dark engineering portfolio for happymonkey.ai — brand refresh from the live Astro site into EmDash.
colors:
  primary: "#8B5CF6"
  primary-hover: "#A78BFA"
  on-primary: "#FFFFFF"
  bg: "#0F172A"
  bg-deeper: "#0A0F1A"
  surface: "#1E293B"
  text: "#CBD5E1"
  heading: "#F1F5F9"
  muted: "#94A3B8"
  border: "#334155"
typography:
  body:
    fontFamily: Poppins
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  h1:
    fontFamily: Poppins
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.02em
  h2:
    fontFamily: Poppins
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.25
  eyebrow:
    fontFamily: Poppins
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.08em
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  xl: 18px
spacing:
  section: 5rem
  frame: 1.25rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    color: "{colors.on-primary}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
---

## Overview

HappyMonkey.AI is a software-first engineering portfolio: projects, open-source tools, insights, and contact. Visual direction is a dark slate canvas with a violet brand accent (measured from live `https://happymonkey.ai`: body `#0f172a`, brand `#8b5cf6`, Poppins). Structure follows Startup / Architect section order (hero → proof → projects → tools → about → writing → contact), not slide-deck mood seeds.

Brand refresh: keep the live site's proposition ("Software first. AI where it helps.") and content inventory; rebuild as EmDash collections, routes, and block components — never as a single HTML dump.

## Colors

- **Canvas:** `#0F172A` / deeper `#0A0F1A` for hero gradients.
- **Surfaces:** `#1E293B` cards on the canvas; hairline borders `#334155`.
- **Brand:** `#8B5CF6` for CTAs, links, focus, logo accent; hover `#A78BFA`.
- **Ink:** headings `#F1F5F9`, body `#CBD5E1`, muted `#94A3B8`.
- Map to EmDash tokens in `theme.css` via `light-dark()` with dark as the intentional default (both sides may use the dark values for dogfood staging).

## Typography

Poppins for body and headings (weights 400–700). Hierarchy by size and weight, not a novelty display face. Eyebrows are small, uppercase-tracked labels for section names.

## Layout

- Shared chrome: sticky header with logo + primary menu + search; footer with brand, legal links, copyright.
- Content width ~1200px for marketing bands; article body ~680px for insights.
- Home is a stack of named sections (see COMPOSITION.md), each one job.
- Project cards: image, title, short description, outbound or detail link.
- Tool strip: compact name + tagline grid.
- Do not use Bootstrap or Font Awesome in the EmDash theme; use EmDash frame/band patterns restyled for this brand.

## Elevation & Depth

Cards use a 1px border and soft shadow on dark surfaces. The home hero uses the brand header video (`/videos/header-video.mp4`) with a dark overlay and poster; `prefers-reduced-motion` falls back to the solid deep band.

## Components

- **Hero:** H1 + lead + CTA group (projects / insights / contact).
- **Project card:** media + title + description.
- **Tool item:** name + one-line tag.
- **Insight row/card:** date, title, excerpt.
- **Contact band:** address/email/phone + mailto primary action (forms plugin wired on staging when recipients are set).
- **Primary button:** violet fill, white text.
- **Ghost button:** border on dark, light text.

## Do's and Don'ts

**Do**

- Keep content in CMS collections and Portable Text / blocks.
- Use distinct Astro routes for home, projects, insights, and legal pages.
- Prefer brand-refresh cues from the live site over unrelated template palettes.

**Don't**

- Stuff a full page of HTML into one template or Portable Text HTML block.
- Ship concept prototypes from `work/page-concepts/` as production bodies.
- Add a second competing accent colour.
- Flatten project and insight layouts into one generic card grid without section purpose.
