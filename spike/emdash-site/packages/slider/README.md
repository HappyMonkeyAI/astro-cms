# @astro-cms/slider

A slider (carousel) block for astro-cms sites. Editors insert it from the editor's slash menu (**Media → Slider**). Sites render it through EmDash's `<PortableText>`, with no template changes.

It's a trusted (native) plugin, because EmDash only loads site-side block renderers (`componentsEntry`) from native plugins.

## Install

```js
// astro.config.mjs
import { slider } from "@astro-cms/slider";

emdash({ plugins: [slider()] });
```

## Editing

**Each slide has:**
- an image URL;
- alt text;
- a heading;
- text;
- an optional button (link and label).

**For the whole block:** autoplay, seconds per slide (3–30) and height (short, medium or tall).

**Images are entered as URLs,** for example `/_emdash/api/media/file/…` copied from the media library. This is because EmDash's Block Kit repeater can't hold a media picker (spike finding F26).

## Rendering

- **Without JavaScript:** a horizontally scrollable, snap-aligned strip, so every slide stays reachable.
- **With JavaScript:**
  - previous and next buttons, slide dots, and the arrow keys on the focused track;
  - slides that aren't showing are `inert`.
- **Autoplay:**
  - only with two or more slides;
  - pauses on hover and focus;
  - stops for good when the visitor uses a control;
  - has a pause button;
  - never runs under `prefers-reduced-motion`.
- **Safety:** only site paths and `http(s)` URLs are rendered, for both images and links. Slides without a usable image are skipped, and there are at most 12 slides.
- **Styling** uses the theme's tokens (`--color-brand`, `--color-on-brand`, `--color-surface`, `--color-border`, `--radius-lg`) when they exist.

## Tests

`npm test`: unit tests for the normaliser (URL safety, bounds, autoplay rules) and the editor form's field types.
