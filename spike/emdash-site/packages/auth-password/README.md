# @astro-cms/auth-password

Email and password sign-in for EmDash, built on its pluggable `authProviders` API. It adds to the built-in passkey flow rather than replacing it: the setup wizard and the login page offer **Password** next to passkeys. No EmDash source is modified.

```js
// astro.config.mjs
import { password } from "@astro-cms/auth-password";

emdash({
	authProviders: [password({ minLength: 12, maxAttempts: 5, lockoutMinutes: 15 })],
});
```

## What it does

- **Setup:** `POST /_emdash/api/setup/password-admin` creates the first admin. It uses the same Postgres advisory lock as core's passkey setup, so the two can't both create an admin. It then marks setup complete and signs the admin in.
- **Login:** `POST /_emdash/api/auth/password/login`.
- **Hashing:** scrypt from `node:crypto` (N=32768, r=8, p=1). The parameters are stored with each hash, so they can be raised later. Input is NFKC-normalised and compared in constant time.
- **No account enumeration:** an unknown email and a wrong password give the same error, and unknown emails are checked against a dummy hash so the response time is the same.
- **Rate limiting:** 5 failed attempts per email and IP within 15 minutes returns 429.
- **Sessions:** the session is regenerated on login, which prevents session fixation.
- **CSRF:** EmDash's middleware rejects cross-origin requests. The admin UI sends `X-EmDash-Request: 1`.
- **Storage:** credentials live in EmDash's `_plugin_storage` table under `auth:password`, as `credentials/<userId>`.

## Known gaps (spike scope)

- **Rate limiting is in-process.** Running several instances needs a shared store.
- **No admin UI for setting or changing a password.** Users invited later sign in with a passkey or magic link until this exists. Auth providers can't add admin pages, so it needs a companion plugin.
- **No password reset by email, and no MFA.**
- **Requires Node** (`node:crypto` scrypt). That fits our Node-first distribution. On Cloudflare Workers, use WebCrypto PBKDF2 instead.

## Tests

```bash
npm test   # node --test, using Node's built-in TypeScript type stripping
```
