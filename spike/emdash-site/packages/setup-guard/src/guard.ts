/**
 * The setup guard's decisions, as pure functions (unit-tested without Astro or a database).
 *
 * A fresh EmDash instance makes whoever completes setup first its admin: through the passkey
 * wizard, our password wizard, or simply by signing in with Google/Microsoft (the OAuth callback
 * grants ADMIN until setup is complete). Spike finding F10.
 *
 * With ASTRO_CMS_SETUP_TOKEN set, and until setup completes, every route that can create the first
 * admin needs proof of the token. The agency opens the site once with `?setup_token=<token>`, which
 * sets an HttpOnly cookie for the rest of the wizard.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const COOKIE = "astro_cms_setup";
export const PARAM = "setup_token";
export const MIN_TOKEN_LENGTH = 24;

/** Routes that can create the first admin, or start a sign-in that would. `status` stays readable. */
export function isGuardedPath(path: string): boolean {
	if (path === "/_emdash/api/setup/status") return false;
	return path === "/_emdash/api/setup" || path.startsWith("/_emdash/api/setup/") || path.startsWith("/_emdash/api/auth/");
}

/** The configured token, if it's long enough to be worth anything. */
export function configuredToken(env: Record<string, string | undefined>): string | undefined {
	const token = env.ASTRO_CMS_SETUP_TOKEN?.trim();
	return token && token.length >= MIN_TOKEN_LENGTH ? token : undefined;
}

/** Constant-time comparison of two strings of any length. */
export function tokenMatches(given: string | undefined | null, expected: string): boolean {
	if (!given) return false;
	const a = createHash("sha256").update(given).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

/** The cookie holds a hash of the token, never the token itself. */
export function cookieValue(token: string): string {
	return createHash("sha256").update(`astro-cms-setup:${token}`).digest("base64url");
}

export function setupComplete(value: unknown): boolean {
	return value === true || value === "true";
}
