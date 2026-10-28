/**
 * Setup guard for astro-cms sites (spike F10): a fresh site can't be claimed without the setup link.
 *
 * Set ASTRO_CMS_SETUP_TOKEN (at least 24 characters; `astro-cms new` generates one) and open
 * `https://<site>/_emdash/admin?setup_token=<token>` to run the setup wizard. Until setup is complete,
 * setup and sign-in routes refuse requests without that link's cookie. Afterwards the guard is inert.
 *
 * @example
 * ```js
 * // First: Astro runs "pre" middleware in integration order, and the setup link must be handled
 * // before EmDash's middleware redirects an unclaimed admin to its wizard.
 * integrations: [setupGuard(), emdash({ ... })]
 * ```
 */

import type { AstroIntegration } from "astro";

export function setupGuard(): AstroIntegration {
	return {
		name: "@astro-cms/setup-guard",
		hooks: {
			"astro:config:setup": ({ addMiddleware }) => {
				// The setup link must run before EmDash redirects an unclaimed admin to its wizard
				addMiddleware({ entrypoint: "@astro-cms/setup-guard/link", order: "pre" });
				// The lock runs after EmDash's middleware has put the database on locals
				addMiddleware({ entrypoint: "@astro-cms/setup-guard/middleware", order: "post" });
			},
		},
	};
}
