/**
 * POST /_emdash/api/auth/password/reset-request   { email }
 *
 * Emails a single-use reset link (30 minutes) if the address has an enabled
 * account. The response is identical for known, unknown, disabled and
 * rate-limited addresses. The email is sent after responding work is queued
 * (not awaited), so SMTP latency doesn't distinguish the cases.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, getPublicOrigin } from "emdash/api/route-utils";

import { buildResetEmail } from "../emails.ts";
import { createRateLimiter, type RateLimiter } from "../rate-limit.ts";
import { getResetStore, getSiteName, readClientAddress, readJson, sendMail, str } from "../shared.ts";
import { issueResetToken } from "../tokens.ts";

let ipLimiter: RateLimiter | undefined;
let emailLimiter: RateLimiter | undefined;

const GENERIC = {
	success: true,
	message: "If an account exists for this email, a reset link has been sent.",
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	try {
		// Every request counts (not just failures): this is an email-sending endpoint.
		ipLimiter ??= createRateLimiter({ maxAttempts: 10, windowMs: 15 * 60_000 });
		emailLimiter ??= createRateLimiter({ maxAttempts: 3, windowMs: 30 * 60_000 });

		const body = await readJson(request);
		const email = str(body?.email).trim().toLowerCase();
		if (!email || email.length > 254) return apiError("VALIDATION_ERROR", "Email is required", 400);

		const ip = readClientAddress(() => clientAddress);
		const blocked = ipLimiter.isBlocked(ip) || emailLimiter.isBlocked(email);
		ipLimiter.recordFailure(ip);
		emailLimiter.recordFailure(email);
		if (blocked) return apiSuccess(GENERIC);

		const user = await createKyselyAdapter(emdash.db).getUserByEmail(email);
		if (!user || user.disabled) {
			// Same storage round trip as the real path, nothing sent.
			await (await getResetStore(emdash)).get("none");
			return apiSuccess(GENERIC);
		}

		const token = await issueResetToken(await getResetStore(emdash), user.id);
		const origin = getPublicOrigin(new URL(request.url), emdash.config as never);
		const url = `${origin}/_emdash/api/auth/password/reset?token=${encodeURIComponent(token)}`;
		const siteName = await getSiteName(emdash);
		// Not awaited on purpose; failures are logged without the link.
		void sendMail(emdash, buildResetEmail({ to: user.email, siteName, url })).catch((error) =>
			console.error("[auth-password] reset email failed:", error instanceof Error ? error.message : "error"),
		);
		return apiSuccess(GENERIC);
	} catch (error) {
		console.error("[auth-password] reset-request error:", error instanceof Error ? error.message : "error");
		return apiSuccess(GENERIC);
	}
};
