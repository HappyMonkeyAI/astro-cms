import type { PageFragmentContribution, PageFragmentEvent, PluginContext, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

import { CLIENT_SCRIPT, DEFAULTS, GCM_DEFAULTS_SCRIPT, renderBanner, resolveSettings, type ConsentSettings } from "./banner.ts";
import type { CookieConsentOptions } from "./index.ts";
import { settingsSchema } from "./settings.ts";

const KEYS = Object.keys(DEFAULTS) as Array<keyof ConsentSettings>;

export async function readSettings(ctx: PluginContext, options: CookieConsentOptions): Promise<ConsentSettings> {
	const stored: Partial<Record<keyof ConsentSettings, unknown>> = {};
	await Promise.all(
		KEYS.map(async (key) => {
			stored[key] = await ctx.settings.get(key);
		}),
	);
	return resolveSettings(options, stored);
}

export function fragments(s: ConsentSettings): PageFragmentContribution[] {
	if (!s.enabled) return [];
	const out: PageFragmentContribution[] = [];
	if (s.googleConsentMode) out.push({ kind: "inline-script", placement: "head", code: GCM_DEFAULTS_SCRIPT, key: "cookie-consent:gcm" });
	out.push({ kind: "html", placement: "body:end", html: renderBanner(s), key: "cookie-consent:banner" });
	out.push({ kind: "inline-script", placement: "body:end", code: CLIENT_SCRIPT, key: "cookie-consent:script" });
	return out;
}

export function createPlugin(options: CookieConsentOptions = {}): ResolvedPlugin {
	return definePlugin({
		id: "cookie-consent",
		version: "0.1.0",
		capabilities: ["hooks.page-fragments:register"],
		admin: { settingsSchema },
		hooks: {
			"page:fragments": async (_event: PageFragmentEvent, ctx: PluginContext) => fragments(await readSettings(ctx, options)),
		},
	});
}

export default createPlugin;
