/**
 * POST /_emdash/api/auth/password/invite-complete
 *
 * Accept an invite by choosing a password instead of registering a passkey.
 * The invite token (from the emailed link) fixes the email and role; it is
 * single-use and consumed here.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { completeInvite, InviteError } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { checkPasswordPolicy, hashPassword } from "../hash.ts";
import { getCredentialStore, getProviderConfig, readJson, str } from "../shared.ts";

const INVITE_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

export const POST: APIRoute = async ({ request, locals, session }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!session) return apiError("SESSION_UNAVAILABLE", "Sessions are not configured", 500);

	try {
		const body = await readJson(request);
		const token = str(body?.token);
		const name = str(body?.name).trim() || undefined;
		const password = str(body?.password);

		if (!INVITE_TOKEN.test(token)) return apiError("INVALID_TOKEN", "Invalid or expired invite", 400);
		const policyError = checkPasswordPolicy(password, getProviderConfig(emdash).minLength);
		if (policyError) return apiError("VALIDATION_ERROR", policyError, 400);

		// Hash before consuming the token, so a failure here leaves the invite usable.
		const hash = await hashPassword(password);
		const user = await completeInvite(createKyselyAdapter(emdash.db), token, { name });

		const credentials = await getCredentialStore(emdash);
		await credentials.put(user.id, { hash, updatedAt: new Date().toISOString() });

		await session.regenerate();
		session.set("user", { id: user.id });
		return apiSuccess({ success: true, user: { id: user.id, email: user.email, role: user.role } });
	} catch (error) {
		if (error instanceof InviteError) {
			const status = error.code === "user_exists" ? 409 : error.code === "token_expired" ? 410 : 400;
			return apiError(error.code.toUpperCase(), error.message, status);
		}
		return handleError(error, "Failed to accept invite", "INVITE_PASSWORD_ERROR");
	}
};
