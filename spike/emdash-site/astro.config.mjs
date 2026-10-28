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
		react(),
		emdash({
			// DATABASE_URL and UPLOADS_DIR are read when the server starts, not at build (SPEC §5.1)
			database: postgresFromEnv(),
			authProviders: [password(), google(), microsoft()],
			// Trusted (native): EmDash ignores page:fragments from sandboxed plugins (cookie-consent),
			// and block renderers (componentsEntry) are native-only (slider)
			plugins: [smtpEmail({ from: { email: "cms@spike.example.com", name: "Spike CMS" } }), cookieConsent(), slider()],
			// Sandboxed: runs in a workerd child process on Node
			// agent-guard: MCP publishes by non-admin (agent) accounts wait for an editor's approval
			sandboxed: [migrationGuard, agentGuard],
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			storage: localFromEnv(),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
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
