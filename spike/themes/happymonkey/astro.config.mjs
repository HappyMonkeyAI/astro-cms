import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";
import { password } from "@astro-cms/auth-password";
import { localFromEnv, postgresFromEnv } from "@astro-cms/runtime-config";
import migrationGuard from "migration-guard";
import agentGuard from "agent-guard";
import { smtpEmail } from "@astro-cms/email-smtp";
import { cookieConsent } from "@astro-cms/cookie-consent";
import { slider } from "@astro-cms/slider";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import { setupGuard } from "@astro-cms/setup-guard";
import { google } from "emdash/auth/providers/google";
import { microsoft } from "emdash/auth/providers/microsoft";

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		setupGuard(),
		react(),
		emdash({
			database: postgresFromEnv(),
			authProviders: [password(), google(), microsoft()],
			plugins: [
				smtpEmail({ from: { email: "cms@happymonkey.ai", name: "HappyMonkey CMS" } }),
				cookieConsent(),
				slider(),
				formsPlugin(),
			],
			sandboxed: [migrationGuard, agentGuard],
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			storage: localFromEnv(),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Poppins",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
