/**
 * /_emdash/api/auth/password/reset
 *
 * GET  ?token=...  Server-rendered "set a new password" page (the emailed
 *                  link). Only validates the token; it is NOT consumed, so
 *                  email scanners that prefetch the link can't use it up.
 * POST             { token, password }  as JSON (returns JSON) or as a form
 *                  post from that page (returns HTML). Consumes the token,
 *                  stores the new scrypt hash. Does not sign the user in, so
 *                  2FA applies on the next login.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { resetPageHtml } from "../emails.ts";
import { checkPasswordPolicy, hashPassword } from "../hash.ts";
import { createRateLimiter, type RateLimiter } from "../rate-limit.ts";
import {
	getCredentialStore,
	getProviderConfig,
	getResetStore,
	readClientAddress,
	readJson,
	str,
} from "../shared.ts";
import { checkResetToken, consumeResetToken, parseResetToken } from "../tokens.ts";

let limiter: RateLimiter | undefined;

const HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Cache-Control": "no-store",
	"Referrer-Policy": "no-referrer",
	"X-Frame-Options": "DENY",
};
const html = (body: string, status = 200) => new Response(body, { status, headers: HEADERS });

export const GET: APIRoute = async ({ url, locals }) => {
	const { emdash } = locals;
	if (!emdash?.db) return html(resetPageHtml({ token: null, message: "Not available." }), 500);
	const token = url.searchParams.get("token") ?? "";
	const valid = parseResetToken(token) && (await checkResetToken(await getResetStore(emdash), token));
	return html(valid ? resetPageHtml({ token }) : resetPageHtml({ token: null }), valid ? 200 : 400);
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const isForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
	let token = "";
	const fail = (code: string, message: string, status: number) =>
		isForm
			? html(resetPageHtml({ token: code === "INVALID_TOKEN" ? null : token, message }), status)
			: apiError(code, message, status);

	try {
		limiter ??= createRateLimiter({ maxAttempts: 10, windowMs: 15 * 60_000 });
		const ip = readClientAddress(() => clientAddress);
		if (limiter.isBlocked(ip)) return fail("RATE_LIMITED", "Too many attempts. Try again later.", 429);

		let password: string;
		if (isForm) {
			const form = await request.formData();
			token = str(form.get("token"));
			password = str(form.get("password"));
			if (password !== str(form.get("confirm"))) return fail("VALIDATION_ERROR", "Passwords do not match", 400);
		} else {
			const body = await readJson(request);
			token = str(body?.token);
			password = str(body?.password);
		}

		const policyError = checkPasswordPolicy(password, getProviderConfig(emdash).minLength);
		if (policyError) return fail("VALIDATION_ERROR", policyError, 400);

		const resets = await getResetStore(emdash);
		// Validate before the expensive hash; failures count against the limiter.
		if (!(await checkResetToken(resets, token))) {
			limiter.recordFailure(ip);
			return fail("INVALID_TOKEN", "This reset link is invalid or has expired.", 400);
		}
		const hash = await hashPassword(password);
		const userId = await consumeResetToken(resets, token);
		if (!userId) {
			limiter.recordFailure(ip);
			return fail("INVALID_TOKEN", "This reset link is invalid or has expired.", 400);
		}

		await (await getCredentialStore(emdash)).put(userId, { hash, updatedAt: new Date().toISOString() });
		// GAP: EmDash sessions are not indexed by user, so existing sessions stay valid (see README).
		return isForm ? html(resetPageHtml({ token: null, done: true })) : apiSuccess({ success: true });
	} catch (error) {
		return isForm
			? html(resetPageHtml({ token: null, message: "Something went wrong. Please try again." }), 500)
			: handleError(error, "Password reset failed", "PASSWORD_RESET_ERROR");
	}
};
