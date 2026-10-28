import { defineMiddleware } from "astro:middleware";

import { COOKIE, cookieValue, configuredToken, PARAM, tokenMatches } from "./guard.ts";

/**
 * The setup link: `?setup_token=<token>` on any URL grants the wizard cookie, then redirects to the
 * same URL without the token. Runs before EmDash's middleware ("pre"), which otherwise redirects an
 * unclaimed site's admin to /_emdash/admin/setup before later middleware sees the request.
 */
export const onRequest = defineMiddleware((context, next) => {
	const offered = context.url.searchParams.get(PARAM);
	if (offered === null) return next();
	const token = configuredToken(process.env);
	const clean = new URL(context.url);
	clean.searchParams.delete(PARAM);
	const headers = new Headers({ Location: clean.pathname + clean.search, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
	if (token && tokenMatches(offered, token)) {
		const secure = context.url.protocol === "https:" ? "; Secure" : "";
		headers.append("Set-Cookie", `${COOKIE}=${cookieValue(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`);
	}
	// A wrong token gets the same redirect, without the cookie, so the link can't be probed for validity
	return new Response(null, { status: 303, headers });
});
