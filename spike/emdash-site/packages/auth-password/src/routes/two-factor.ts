/**
 * /_emdash/api/auth/password/two-factor   (signed-in users only)
 *
 * GET                      -> { enabled, emailAvailable }
 * POST { enabled: true }   -> turn email 2FA on for the caller
 * POST { enabled: false, password } -> turn it off; the current password is
 *                             required so a hijacked session can't strip 2FA.
 *
 * The path is under the provider's public prefix (so the auth middleware
 * doesn't gate it); it authenticates itself from the session user.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { getDummyHash, verifyPassword } from "../hash.ts";
import { createRateLimiter, type RateLimiter } from "../rate-limit.ts";
import { getCredentialStore, getTwoFactorStore, readJson, str } from "../shared.ts";

let limiter: RateLimiter | undefined;

export const GET: APIRoute = async ({ locals, session }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	const sessionUser = await session?.get("user");
	if (!sessionUser?.id) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);
	try {
		return apiSuccess({
			enabled: await (await getTwoFactorStore(emdash)).exists(sessionUser.id),
			emailAvailable: Boolean(emdash.email?.isAvailable()),
		});
	} catch (error) {
		return handleError(error, "Failed to read 2FA state", "TWO_FACTOR_ERROR");
	}
};

export const POST: APIRoute = async ({ request, locals, session }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	const sessionUser = await session?.get("user");
	if (!sessionUser?.id) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);

	try {
		const user = await createKyselyAdapter(emdash.db).getUserById(sessionUser.id);
		if (!user || user.disabled) return apiError("NOT_AUTHENTICATED", "Sign in first", 401);

		const body = await readJson(request);
		const store = await getTwoFactorStore(emdash);

		if (body?.enabled === true) {
			if (!emdash.email?.isAvailable()) {
				return apiError("EMAIL_NOT_CONFIGURED", "Email isn't configured, so codes couldn't be delivered", 503);
			}
			await store.put(user.id, { enabledAt: new Date().toISOString() });
			return apiSuccess({ enabled: true });
		}

		if (body?.enabled === false) {
			limiter ??= createRateLimiter({ maxAttempts: 5, windowMs: 15 * 60_000 });
			if (limiter.isBlocked(user.id)) return apiError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
			const credential = await (await getCredentialStore(emdash)).get(user.id);
			const valid = await verifyPassword(str(body.password), credential?.hash ?? (await getDummyHash()));
			if (!credential || !valid) {
				limiter.recordFailure(user.id);
				return apiError("INVALID_CREDENTIALS", "Incorrect password", 401);
			}
			limiter.reset(user.id);
			await store.delete(user.id);
			return apiSuccess({ enabled: false });
		}

		return apiError("VALIDATION_ERROR", "`enabled` must be true or false", 400);
	} catch (error) {
		return handleError(error, "Failed to update 2FA", "TWO_FACTOR_ERROR");
	}
};
