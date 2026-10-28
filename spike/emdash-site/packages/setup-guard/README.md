# @astro-cms/setup-guard

Stops a fresh astro-cms site from being claimed by whoever reaches it first (spike finding F10).

An unclaimed EmDash site makes its first claimant the admin, by any of these routes:
- the passkey wizard;
- our password wizard;
- simply signing in with Google or Microsoft (the OAuth callback grants Admin until setup is complete).

With this guard, those routes are locked until someone opens the site's setup link.

## Use

```js
// astro.config.mjs
import { setupGuard } from "@astro-cms/setup-guard";

integrations: [setupGuard(), emdash({ ... })]   // setupGuard() must come first
```

1. Set `ASTRO_CMS_SETUP_TOKEN` (at least 24 characters). `astro-cms new` generates it.
2. Open `https://<site>/_emdash/admin?setup_token=<token>`.
3. The link sets an HttpOnly cookie (a hash of the token, not the token) and redirects to the same URL without the token. The wizard then works normally.

## Behaviour

- **Until setup completes:**
  - Every `/_emdash/api/setup/*` route (except `status`) and every `/_emdash/api/auth/*` route answers `403 SETUP_LOCKED` to anyone without the cookie.
  - A wrong token gets the same redirect, without a cookie, so the link can't be probed for validity.
- **After setup:** the guard switches itself off for the life of the process. Setup can't be repeated, and sign-in works normally.
- **Without a token:** the guard logs a warning and leaves the site open, which is EmDash's default behaviour. Local development keeps working.

## Why `setupGuard()` comes first

- **The link is "pre" middleware.** It must run before EmDash's middleware, which redirects an unclaimed admin straight to `/_emdash/admin/setup`. Astro runs "pre" middleware in integration order.
- **The lock is "post" middleware.** It runs after EmDash has put the database on `locals`.

## Tests

`npm test`: which paths are guarded, the token length rule, constant-time comparison, the cookie value, and the completion flag.
