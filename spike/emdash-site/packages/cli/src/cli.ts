#!/usr/bin/env node
/**
 * astro-cms: agency CLI for astro-cms sites.
 *
 *   astro-cms token profiles
 *   astro-cms token create --base <site-url> --profile <agent-editor|agent-readonly|migration> --name <name> [--expires 30d]
 *   astro-cms token list   --base <site-url>
 *   astro-cms token revoke --base <site-url> --id <token-id>
 *
 * Authenticates with an admin-scope token in ASTRO_CMS_ADMIN_TOKEN. The created token is
 * printed once and never stored.
 */

import { parseLifetime, PROFILES } from "./profiles.ts";
import { tokenClient } from "./tokens.ts";

const [group, command, ...args] = process.argv.slice(2);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};

function usage(): never {
	console.error(
		[
			"Usage: astro-cms token profiles",
			"       astro-cms token create --base <site-url> --profile <name> --name <token-name> [--expires 30d|12h]",
			"       astro-cms token list --base <site-url>",
			"       astro-cms token revoke --base <site-url> --id <token-id>",
			"Admin token: ASTRO_CMS_ADMIN_TOKEN",
		].join("\n"),
	);
	process.exit(2);
}

if (group !== "token") usage();

if (command === "profiles") {
	for (const [name, p] of Object.entries(PROFILES)) console.log(`${name.padEnd(15)} ${p.days}d  ${p.description}\n${" ".repeat(19)}${p.scopes.join(" ")}`);
	process.exit(0);
}

const base = option("--base");
const adminToken = process.env.ASTRO_CMS_ADMIN_TOKEN;
if (!base) usage();
if (!adminToken) {
	console.error("Set ASTRO_CMS_ADMIN_TOKEN to an admin-scope API token for the site.");
	process.exit(2);
}
const tokens = tokenClient(base, adminToken);

if (command === "create") {
	const profileName = option("--profile");
	const name = option("--name");
	const profile = profileName ? PROFILES[profileName] : undefined;
	if (!profile || !name) usage();
	const expiresAt = new Date(Date.now() + parseLifetime(option("--expires"), profile.days));
	const { token, info } = await tokens.create(name, profile.scopes, expiresAt);
	console.log(`Created "${info.name}" (${profileName}, id ${info.id}), expires ${info.expiresAt}`);
	console.log(`Scopes: ${info.scopes.join(" ")}`);
	console.log(`\n${token}\n\nThis is the only time the token is shown. Store it in the agent's secret store.`);
} else if (command === "list") {
	for (const t of await tokens.list()) {
		const profile = Object.entries(PROFILES).find(([, p]) => p.scopes.length === t.scopes.length && p.scopes.every((s) => t.scopes.includes(s)))?.[0] ?? "custom";
		console.log(`${t.id}  ${t.prefix}…  ${t.name.padEnd(24)} ${profile.padEnd(15)} expires ${t.expiresAt ?? "never"}  last used ${t.lastUsedAt ?? "never"}`);
	}
} else if (command === "revoke") {
	const id = option("--id");
	if (!id) usage();
	await tokens.revoke(id);
	console.log(`Revoked ${id}`);
} else {
	usage();
}
