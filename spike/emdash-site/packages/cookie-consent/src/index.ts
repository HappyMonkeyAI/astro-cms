/**
 * Cookie consent banner for astro-cms sites.
 *
 * A trusted (native) plugin: EmDash ignores `page:fragments` hooks from sandboxed plugins,
 * so a banner that injects HTML and scripts into public pages has to run in-process.
 *
 * Options set site defaults; editors override them in the admin under the plugin's settings.
 *
 * @example
 * ```js
 * emdash({ plugins: [cookieConsent({ policyUrl: "/pages/cookies" })] });
 * ```
 */

import type { PluginDescriptor } from "emdash";

import type { ConsentSettings } from "./banner.ts";
import { settingsSchema } from "./settings.ts";

export type CookieConsentOptions = Partial<ConsentSettings>;
export { CATEGORIES, DEFAULTS, type ConsentSettings } from "./banner.ts";

export function cookieConsent(options: CookieConsentOptions = {}): PluginDescriptor<CookieConsentOptions> {
	return {
		id: "cookie-consent",
		version: "0.1.0",
		entrypoint: "@astro-cms/cookie-consent/plugin",
		format: "native",
		options,
		capabilities: ["hooks.page-fragments:register"],
		settingsSchema,
	};
}
