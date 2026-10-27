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

## Routes

All under `/_emdash/api/auth/password/` (a public prefix, so EmDash's auth middleware doesn't gate them; CSRF is the Origin / `X-EmDash-Request` check).

| Method + path | Who | Request | Response |
|---|---|---|---|
| `POST login` | public | `{email, password}` | `{success:true}` (session created), or `{twoFactorRequired:true, challenge}` when 2FA is on (no session yet) |
| `POST login-verify` | public | `{challenge, code}` | `{success:true}` (session created). 401 `INVALID_CODE` / `CODE_EXPIRED` / `CODE_LOCKED` |
| `POST reset-request` | public | `{email}` | always the same `{success:true, message}` |
| `GET reset?token=` | public | the emailed link | HTML "set a new password" page (does not consume the token) |
| `POST reset` | public | `{token, password}` JSON, or the page's form post | `{success:true}` / HTML. Does not sign in |
| `GET two-factor` | signed in | | `{enabled, emailAvailable}` |
| `POST two-factor` | signed in | `{enabled:true}` or `{enabled:false, password}` | `{enabled}` |
| `POST invite-complete` | public | see invite flow | |

## Password reset flow

1. Login form, "Forgot password?" -> `reset-request`. A link `/_emdash/api/auth/password/reset?token=<userId>.<secret>` is emailed (30 minutes, single use). Unknown, disabled and rate-limited addresses get the identical response and no email. The send is not awaited, so SMTP latency doesn't leak account existence.
2. The link opens a small server-rendered page (works without the admin SPA knowing about the token). `GET` only validates, so link-scanning mail gateways can't use the token up.
3. Submitting calls `reset`: the password passes `checkPasswordPolicy` (minLength config), is hashed with scrypt, the token is consumed atomically, the credential is replaced. The user then signs in normally (so 2FA still applies). A reset also works for accounts that had no password (passkey/OAuth users), which is no weaker than the magic link they could already request.

## Email 2FA flow (opt-in per account)

1. Signed-in user calls `POST two-factor {"enabled":true}` (disable requires the current password). Refused when no email transport is configured.
2. `login` with a correct password then emails a 6-digit code and returns `{twoFactorRequired, challenge}`. If email is unavailable it fails closed (503), it never falls back to password-only.
3. `login-verify` checks the code and only then regenerates the session and sets the user, same as `login`.

Enable from a browser console while signed in: `fetch("/_emdash/api/auth/password/two-factor",{method:"POST",headers:{"Content-Type":"application/json","X-EmDash-Request":"1"},body:JSON.stringify({enabled:true})})`.

## Security notes

- Reset tokens (32 random bytes) and codes (`crypto.randomInt`) are stored hashed: sha256 for tokens; HMAC-SHA256 with a per-record salt for codes, keyed under sha256(challenge id). A 6-digit code is brute-forceable offline from a leaked DB within its 10-minute life, which is why it's also capped at 5 attempts, single use, and short lived.
- Single use is decided by the storage `delete` result (only one caller removes the row). Reset tokens are one-per-user: a new request invalidates the previous link. Code attempts are serialised per challenge in-process.
- Limits (in-memory, per instance, same caveat as login): reset-request 10/IP and 3/email per window, reset 10 failures/IP, login-verify 10 failures/IP + 5 wrong codes per challenge, 5 codes emailed per user per 10 minutes, 2FA disable 5 wrong passwords.
- Email goes through `locals.emdash.email.send(message, "system")`, the same call core's magic-link route makes, so the configured `email:deliver` transport (`@astro-cms/email-smtp`) is used. The link origin comes from `getPublicOrigin` (honours the site's public URL config). Logs never include links or codes.
- The reset page sends `no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- Because the reset link and the 2FA code travel over the same channel, a compromised mailbox defeats both; that's inherent to email-based 2FA.

## Known gaps (spike scope)

- **Rate limiting is in-process.** Running several instances needs a shared store.
- **No admin UI for setting or changing a password.** Users invited later sign in with a passkey or magic link until this exists. Auth providers can't add admin pages, so it needs a companion plugin.
- **Existing sessions are not invalidated on password reset.** EmDash keeps sessions in Astro's session store keyed by session id, with no per-user index and no revoke-by-user API, so a provider can't end a user's other sessions. Closing this needs a core hook or a per-user "sessions valid after" check in EmDash's auth middleware.
- **No authenticator-app MFA, no admin UI toggle for email 2FA** (API only).
- **Requires Node** (`node:crypto` scrypt). That fits our Node-first distribution. On Cloudflare Workers, use WebCrypto PBKDF2 instead.

## Tests

```bash
npm test   # node --test, using Node's built-in TypeScript type stripping
```
