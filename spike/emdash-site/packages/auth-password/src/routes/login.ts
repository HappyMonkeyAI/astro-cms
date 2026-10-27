/**
 * POST /_emdash/api/auth/password/login
 *
 * Sign in with email + password. Unknown email and wrong password return the
 * same error and take the same time (a dummy hash is verified for unknown users).
 *
 * If email 2FA is enabled for the account, a correct password does NOT create
 * a session: a 6-digit code is emailed and `{ twoFactorRequired: true,
 * challenge }` is returned; finish with POST .../login-verify.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { getDummyHash, verifyPassword } from "../hash.ts";
import { createRateLimiter, type RateLimiter } from "../rate-limit.ts";
import { buildCodeEmail } from "../emails.ts";
import {
	getChallengeStore,
	getCredentialStore,
	getProviderConfig,
	getSiteName,
	getTwoFactorStore,
	readClientAddress,
	readJson,
	sendMail,
	str,
} from "../shared.ts";
import { issueChallenge } from "../tokens.ts";

let limiter: RateLimiter | undefined;
// Counts codes emailed per user, so a known password can't be used to spam an inbox.
let codeSendLimiter: RateLimiter | undefined;

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

		if (await (await getTwoFactorStore(emdash)).exists(user.id)) {
			codeSendLimiter ??= createRateLimiter({ maxAttempts: 5, windowMs: 10 * 60_000 });
			if (codeSendLimiter.isBlocked(user.id)) {
				return apiError("RATE_LIMITED", "Too many codes requested. Try again later.", 429);
			}
			// Fail closed: with no email transport the code can't be delivered.
			if (!emdash.email?.isAvailable()) {
				return apiError("EMAIL_NOT_CONFIGURED", "Sign-in codes can't be sent right now.", 503);
			}
			codeSendLimiter.recordFailure(user.id);
			const { challengeId, code } = await issueChallenge(await getChallengeStore(emdash), user.id);
			await sendMail(emdash, buildCodeEmail({ to: user.email, siteName: await getSiteName(emdash), code }));
			return apiSuccess({ twoFactorRequired: true, challenge: challengeId });
		}

		await session.regenerate();
		session.set("user", { id: user.id });
		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Sign-in failed", "PASSWORD_LOGIN_ERROR");
	}
};
