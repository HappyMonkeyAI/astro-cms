import { defineMiddleware } from "astro:middleware";
import { OptionsRepository } from "emdash/api/route-utils";

import { COOKIE, cookieValue, configuredToken, isGuardedPath, setupComplete } from "./guard.ts";

// Setup only ever goes from incomplete to complete, so once seen it never needs checking again
let complete = false;
let warned = false;

/** The lock. Runs after EmDash's middleware ("post"), which puts the database on locals. */
export const onRequest = defineMiddleware(async (context, next) => {
	if (complete) return next();
	const token = configuredToken(process.env);
	const db = (context.locals as { emdash?: { db?: unknown } }).emdash?.db;

	if (!isGuardedPath(context.url.pathname) || !db) return next();
	if (setupComplete(await new OptionsRepository(db as never).get("emdash:setup_complete"))) {
		complete = true;
		return next();
	}
	if (!token) {
		if (!warned) {
			warned = true;
			console.warn("[setup-guard] ASTRO_CMS_SETUP_TOKEN is not set: anyone who reaches this site can claim it until setup is complete.");
		}
		return next();
	}
	if (context.cookies.get(COOKIE)?.value === cookieValue(token)) return next();
	return new Response(JSON.stringify({ error: { code: "SETUP_LOCKED", message: "This site hasn't been set up yet. Open the setup link from your agency to continue." } }), {
		status: 403,
		headers: { "Content-Type": "application/json" },
	});
});
