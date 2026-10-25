/**
 * POST /_emdash/api/auth/password/login
 *
 * Sign in with email + password. Unknown email and wrong password return the
 * same error and take the same time (a dummy hash is verified for unknown users).
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { getDummyHash, verifyPassword } from "../hash.ts";
import { createRateLimiter, type RateLimiter } from "../rate-limit.ts";
import { getCredentialStore, getProviderConfig, readClientAddress, readJson, str } from "../shared.ts";

let limiter: RateLimiter | undefined;

export const POST: APIRoute = async ({ request, locals, session, clientAddress }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!session) return apiError("SESSION_UNAVAILABLE", "Sessions are not configured", 500);

	try {
		const config = getProviderConfig(emdash);
		limiter ??= createRateLimiter({
			maxAttempts: config.maxAttempts ?? 5,
			windowMs: (config.lockoutMinutes ?? 15) * 60_000,
		});

		const body = await readJson(request);
		const email = str(body?.email).trim().toLowerCase();
		const password = str(body?.password);
		if (!email || !password) return apiError("VALIDATION_ERROR", "Email and password are required", 400);

		const key = `${readClientAddress(() => clientAddress)}|${email}`;
		if (limiter.isBlocked(key)) {
			return apiError("RATE_LIMITED", "Too many failed attempts. Try again later.", 429);
		}

		const adapter = createKyselyAdapter(emdash.db);
		const user = await adapter.getUserByEmail(email);
		const credential = user ? await (await getCredentialStore(emdash)).get(user.id) : null;
		const valid = await verifyPassword(password, credential?.hash ?? (await getDummyHash()));

		if (!user || !credential || !valid) {
			limiter.recordFailure(key);
			return apiError("INVALID_CREDENTIALS", "Incorrect email or password", 401);
		}
		if (user.disabled) return apiError("ACCOUNT_DISABLED", "Account disabled", 403);

		limiter.reset(key);
		await session.regenerate();
		session.set("user", { id: user.id });
		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Sign-in failed", "PASSWORD_LOGIN_ERROR");
	}
};
