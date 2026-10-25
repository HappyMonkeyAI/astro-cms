/**
 * POST /_emdash/api/setup/password-admin
 *
 * Setup wizard: create the first admin with email + password, then sign in.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { apiError, apiSuccess, finalizeSetup, handleError, OptionsRepository } from "emdash/api/route-utils";

import { checkPasswordPolicy, hashPassword } from "../hash.ts";
import { createFirstAdmin, getCredentialStore, getProviderConfig, readJson, str } from "../shared.ts";

export const POST: APIRoute = async ({ request, locals, session }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	if (!session) return apiError("SESSION_UNAVAILABLE", "Sessions are not configured", 500);

	try {
		const options = new OptionsRepository(emdash.db);
		const setupComplete = await options.get("emdash:setup_complete");
		const adapter = createKyselyAdapter(emdash.db);
		if ((await adapter.countUsers()) > 0) {
			const complete = setupComplete === true || setupComplete === "true";
			return complete
				? apiError("SETUP_COMPLETE", "Setup already complete", 400)
				: apiError("ADMIN_EXISTS", "Admin user already exists", 400);
		}

		const body = await readJson(request);
		const email = str(body?.email).trim().toLowerCase();
		const name = str(body?.name).trim() || null;
		const password = str(body?.password);

		if (!email.includes("@")) return apiError("VALIDATION_ERROR", "Please enter a valid email", 400);
		const policyError = checkPasswordPolicy(password, getProviderConfig(emdash).minLength);
		if (policyError) return apiError("VALIDATION_ERROR", policyError, 400);

		// Hash before inserting, so a slow/failed hash can't leave a user without a credential.
		const hash = await hashPassword(password);

		const user = await createFirstAdmin(emdash, { email, name });
		if (!user) return apiError("ADMIN_EXISTS", "Admin user already exists", 400);

		const credentials = await getCredentialStore(emdash);
		await credentials.put(user.id, { hash, updatedAt: new Date().toISOString() });

		await finalizeSetup(emdash.db);
		await options.delete("emdash:setup_state");

		await session.regenerate();
		session.set("user", { id: user.id });

		console.log(`[auth-password] Setup complete: created admin ${email}`);
		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Failed to create admin", "SETUP_PASSWORD_ERROR");
	}
};
