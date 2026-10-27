/**
 * POST /_emdash/api/auth/password/login-verify   { challenge, code }
 *
 * Second step of sign-in for accounts with email 2FA. The challenge id comes
 * from /login; the code from the email. The code is single-use, expires after
 * 10 minutes and locks after 5 wrong tries. The session is created here, the
 * same way /login does (regenerate, then set the user).
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { createRateLimiter, type RateLimiter } from "../rate-limit.ts";
import { getChallengeStore, readClientAddress, readJson, str } from "../shared.ts";
import { verifyChallenge } from "../tokens.ts";

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

let limiter: RateLimiter | undefined;

export const POST: APIRoute = async ({ request, locals, session, clientAddress }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!session) return apiError("SESSION_UNAVAILABLE", "Sessions are not configured", 500);

	try {
		limiter ??= createRateLimiter({ maxAttempts: 10, windowMs: 15 * 60_000 });
		const body = await readJson(request);
		const challenge = str(body?.challenge);
		const code = str(body?.code);
		if (!CHALLENGE.test(challenge) || !code) {
			return apiError("VALIDATION_ERROR", "Enter the 6-digit code from your email", 400);
		}

		const ip = readClientAddress(() => clientAddress);
		if (limiter.isBlocked(ip)) {
			return apiError("RATE_LIMITED", "Too many failed attempts. Try again later.", 429);
		}

		const result = await verifyChallenge(await getChallengeStore(emdash), challenge, code);
		if (!result.ok) {
			limiter.recordFailure(ip);
			if (result.reason === "expired") return apiError("CODE_EXPIRED", "That code has expired. Sign in again.", 401);
			if (result.reason === "locked") return apiError("CODE_LOCKED", "Too many wrong codes. Sign in again.", 401);
			return apiError("INVALID_CODE", "That code isn't right", 401);
		}

		const user = await createKyselyAdapter(emdash.db).getUserById(result.userId);
		if (!user) return apiError("INVALID_CODE", "That code isn't right", 401);
		if (user.disabled) return apiError("ACCOUNT_DISABLED", "Account disabled", 403);

		limiter.reset(ip);
		await session.regenerate();
		session.set("user", { id: user.id });
		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Sign-in failed", "PASSWORD_LOGIN_VERIFY_ERROR");
	}
};
