import type { SettingField } from "emdash";

import { DEFAULTS, type ConsentSettings } from "./banner.ts";

/** The admin settings form. Declared on both the descriptor and the plugin definition. */
export const settingsSchema: Record<keyof ConsentSettings, SettingField> = {
	enabled: { type: "boolean", label: "Show the banner", default: DEFAULTS.enabled },
	title: { type: "string", label: "Title", default: DEFAULTS.title },
	message: { type: "string", label: "Message", multiline: true, default: DEFAULTS.message },
	policyUrl: { type: "string", label: "Cookie policy link", description: "A site path such as /pages/cookies, or a full https:// URL. Leave empty to hide the link." },
	policyLabel: { type: "string", label: "Cookie policy link text", default: DEFAULTS.policyLabel },
	acceptLabel: { type: "string", label: "Accept button", default: DEFAULTS.acceptLabel },
	rejectLabel: { type: "string", label: "Reject button", default: DEFAULTS.rejectLabel },
	manageLabel: { type: "string", label: "Preferences link", default: DEFAULTS.manageLabel },
	position: {
		type: "select",
		label: "Position",
		options: [
			{ value: "bottom", label: "Bottom bar" },
			{ value: "bottom-left", label: "Bottom-left card" },
		],
		default: DEFAULTS.position,
	},
	revision: { type: "number", label: "Consent revision", description: "Increase this after changing your cookie policy to ask every visitor again.", min: 1, default: DEFAULTS.revision },
	googleConsentMode: { type: "boolean", label: "Google Consent Mode v2", description: "Send consent to Google tags (GA4, Ads). Denied until the visitor opts in.", default: DEFAULTS.googleConsentMode },
};
