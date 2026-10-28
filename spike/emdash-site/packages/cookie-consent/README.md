# @astro-cms/cookie-consent

A cookie consent banner for astro-cms sites. It keeps analytics and marketing scripts switched off until the visitor opts in.

It's a trusted (native) plugin, because EmDash ignores `page:fragments` hooks from sandboxed plugins (spike finding F25).

## Install

```js
// astro.config.mjs
import { cookieConsent } from "@astro-cms/cookie-consent";

emdash({ plugins: [cookieConsent({ policyUrl: "/pages/cookies" })] });
```

Options set the site's defaults. Editors can override every option in the admin, under the plugin's settings:
- banner text and button labels;
- the policy link;
- position;
- revision;
- Google Consent Mode.

## Gate your scripts

Mark each non-essential script as inert, and name its category (`analytics` or `marketing`):

```html
<script type="text/plain" data-consent="analytics" src="https://www.googletagmanager.com/gtag/js?id=G-XXXX" async></script>
<script type="text/plain" data-consent="analytics">
  window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments)}
  gtag("js", new Date()); gtag("config", "G-XXXX");
</script>
```

The banner activates these scripts once the visitor grants that category, either straight away or on a later visit.

**Google Consent Mode v2.** If you turn it on, tags may load immediately: consent defaults to denied, and is updated when the visitor chooses.

## Behaviour

- **Accept and reject look the same.** "Reject non-essential" is as prominent as "Accept all", as UK and EU guidance expects. "Manage preferences" offers per-category choices.
- **The choice is stored for 180 days** in a first-party cookie, `cms_consent=<revision>:<categories>` (SameSite=Lax; Secure on HTTPS).
- **Raise "Consent revision"** in settings after a policy change, to ask everyone again.
- **To reopen the banner,** use any element with `data-cookie-settings`, or a link to `#cookie-settings`. Footers should have one.
- **Scripting API:**
  - `window.cmsConsent.get()` returns `{ necessary, analytics, marketing }`, or `null` before a choice.
  - `window.cmsConsent.open()` opens the banner.
  - A `cms:consent` event fires on `window` with the same detail.
- **Styling** uses the theme's tokens (`--color-surface`, `--color-text`, `--color-brand`, `--color-on-brand`, `--color-border`) when they exist.
- **All editor text is HTML-escaped.** The policy link accepts only site paths and `http(s)` URLs.

## Not yet

- A server-side consent log, for proof of consent.
- More categories than analytics and marketing.

## Tests

`npm test`: unit tests for the settings merge, escaping and URL safety, and a parse check of the client script.
