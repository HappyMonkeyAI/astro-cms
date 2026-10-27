/**
 * /_emdash/api/agents   (admins only; tokens need the admin scope)
 *
 * POST { name, scopes, expiresAt, role? }  create an agent account and its API token.
 *      The token is returned once; it belongs to the agent account, not to the caller.
 * GET  list agent accounts with their tokens (no secrets).
 *
 * Disable an agent with EmDash's own POST /_emdash/api/admin/users/:id/disable; its tokens
 * stop working immediately.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { generatePrefixedToken, hasScope, isValidScope } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, handleError } from "emdash/api/route-utils";

import { AGENT_EMAIL_DOMAIN, agentEmail, parseAgentRequest, ulid } from "../agents.ts";
import { readJson } from "../shared.ts";

const ADMIN = 50;

function denied(locals: App.Locals): Response | null {
	const { user, tokenScopes } = locals as { user?: { role: number }; tokenScopes?: string[] };
	if (!user || user.role < ADMIN) return apiError("FORBIDDEN", "Admin privileges required", 403);
	// Session callers have no tokenScopes; token callers must hold the admin scope itself
	if (tokenScopes && !hasScope(tokenScopes, "admin")) return apiError("INSUFFICIENT_SCOPE", "Requires the admin scope", 403);
	return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	const refusal = denied(locals);
	if (refusal) return refusal;
	try {
		const parsed = parseAgentRequest(await readJson(request), isValidScope);
		if (typeof parsed === "string") return apiError("VALIDATION_ERROR", parsed, 400);

		const random = ulid().slice(-6).toLowerCase();
		const user = await createKyselyAdapter(emdash.db).createUser({
			email: agentEmail(parsed.name, random),
			name: `Agent: ${parsed.name}`,
			role: parsed.role,
			emailVerified: false,
		});
		const { raw, hash, prefix } = generatePrefixedToken("ec_pat_");
		const tokenId = ulid();
		await (emdash.db as any)
			.insertInto("_emdash_api_tokens")
			.values({ id: tokenId, name: parsed.name, token_hash: hash, prefix, user_id: user.id, scopes: JSON.stringify(parsed.scopes), expires_at: parsed.expiresAt })
			.execute();

		return apiSuccess(
			{
				token: raw,
				agent: { id: user.id, name: user.name, email: user.email, role: user.role },
				info: { id: tokenId, prefix, scopes: parsed.scopes, expiresAt: parsed.expiresAt },
			},
			201,
		);
	} catch (error) {
		return handleError(error, "Failed to create agent account", "AGENT_CREATE_ERROR");
	}
};

export const GET: APIRoute = async ({ locals }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	const refusal = denied(locals);
	if (refusal) return refusal;
	try {
		const db = emdash.db as any;
		const users = await db
			.selectFrom("users")
			.select(["id", "name", "email", "role", "disabled", "created_at"])
			.where("email", "like", `%@${AGENT_EMAIL_DOMAIN}`)
			.orderBy("created_at", "desc")
			.execute();
		const tokens = users.length
			? await db
					.selectFrom("_emdash_api_tokens")
					.select(["id", "user_id", "name", "prefix", "scopes", "expires_at", "last_used_at", "created_at"])
					.where("user_id", "in", users.map((u: { id: string }) => u.id))
					.execute()
			: [];
		return apiSuccess({
			items: users.map((u: any) => ({
				id: u.id,
				name: u.name,
				email: u.email,
				role: u.role,
				disabled: Boolean(u.disabled),
				createdAt: u.created_at,
				tokens: tokens
					.filter((t: any) => t.user_id === u.id)
					.map((t: any) => ({ id: t.id, name: t.name, prefix: t.prefix, scopes: JSON.parse(t.scopes), expiresAt: t.expires_at, lastUsedAt: t.last_used_at })),
			})),
		});
	} catch (error) {
		return handleError(error, "Failed to list agent accounts", "AGENT_LIST_ERROR");
	}
};
