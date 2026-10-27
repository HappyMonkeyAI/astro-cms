import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { postgres, sqlite } from "emdash/db";
import { password } from "@astro-cms/auth-password";
import migrationGuard from "migration-guard";
import { smtpEmail } from "@astro-cms/email-smtp";
import { google } from "emdash/auth/providers/google";
import { microsoft } from "emdash/auth/providers/microsoft";

// Spike: Postgres when DATABASE_URL is set AT BUILD TIME (EmDash serialises this config into dist).
// FINDING: there is no runtime env lookup for Postgres, so the password ends up in the built output.
const database = process.env.DATABASE_URL
	? postgres({ connectionString: process.env.DATABASE_URL })
	: sqlite({ url: "file:./data.db" });

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
			database,
			authProviders: [password(), google(), microsoft()],
			plugins: [smtpEmail({ from: { email: "cms@spike.example.com", name: "Spike CMS" } })],
			// Sandboxed: runs in a workerd child process on Node
			sandboxed: [migrationGuard],
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			storage: local({
				directory: process.env.UPLOADS_DIR ?? "./uploads", // also serialised at build time
				baseUrl: "/_emdash/api/media/file",
			}),
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
