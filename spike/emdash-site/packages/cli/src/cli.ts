#!/usr/bin/env node
/**
 * astro-cms: agency CLI for astro-cms sites.
 *
 *   astro-cms plugin new <slug> [--dir plugins] [--description <text>]   generate a sandboxed plugin
 *
 *   astro-cms token profiles
 *   astro-cms token create --base <site-url> --profile <agent-editor|agent-readonly|migration> --name <name> [--expires 30d]
 *   astro-cms token list   --base <site-url>
 *   astro-cms token revoke --base <site-url> --id <token-id>
 *
 *   astro-cms agent create  --base <site-url> --name <agent> [--profile agent-editor|agent-readonly] [--role editor|author] [--expires 90d]
 *   astro-cms agent list    --base <site-url>
 *   astro-cms agent disable --base <site-url> --id <agent-user-id>
 *
 * Agents get their own non-admin account owning their token (needs @astro-cms/auth-password's
 * /_emdash/api/agents route), so agent-guard holds their publishes and edits are attributed to them.
 *
 * Authenticates with an admin-scope token in ASTRO_CMS_ADMIN_TOKEN. The created token is
 * printed once and never stored.
 */

import { resolve } from "node:path";

import { parseLifetime, PROFILES } from "./profiles.ts";
import { defaults, scaffoldPlugin, validateSlug } from "./scaffold.ts";
import { agentClient, tokenClient } from "./tokens.ts";

const [group, command, ...args] = process.argv.slice(2);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};

function usage(): never {
	console.error(
		[
			"Usage: astro-cms plugin new <slug> [--dir plugins] [--description <text>] [--publisher <did>] [--author <name>] [--security-email <email>]",
			"       astro-cms token profiles",
			"       astro-cms token create --base <site-url> --profile <name> --name <token-name> [--expires 30d|12h]",
			"       astro-cms token list --base <site-url>",
			"       astro-cms token revoke --base <site-url> --id <token-id>",
			"       astro-cms agent create --base <site-url> --name <agent> [--profile agent-editor|agent-readonly] [--role editor|author] [--expires 90d]",
			"       astro-cms agent list --base <site-url>",
			"       astro-cms agent disable --base <site-url> --id <agent-user-id>",
			"Admin token: ASTRO_CMS_ADMIN_TOKEN",
		].join("\n"),
	);
	process.exit(2);
}

if (group === "plugin") {
	if (command !== "new" || !args[0] || args[0].startsWith("--")) usage();
	const slug = args[0];
	const problem = validateSlug(slug);
	if (problem) {
		console.error(problem);
		process.exit(2);
	}
	const dir = resolve(option("--dir") ?? ".", slug);
	const vars = defaults(slug, {
		description: option("--description"),
		publisher: option("--publisher"),
		author: option("--author"),
		securityEmail: option("--security-email"),
	});
	const files = await scaffoldPlugin(dir, vars);
	console.log(`Created ${vars.title} in ${dir} (${files.length} files)`);
	console.log(`\nNext:\n  cd ${dir}\n  npm install\n  npm run check     # typecheck, validate, test, build`);
	console.log(`\nThen read skills/creating-plugins/SKILL.md and ASTRO-CMS.md, and see README.md to add it to a site.`);
	process.exit(0);
}

if (group !== "token" && group !== "agent") usage();

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

if (group === "agent") {
	const agents = agentClient(base, adminToken);
	if (command === "create") {
		const profileName = option("--profile") ?? "agent-editor";
		const name = option("--name");
		const profile = PROFILES[profileName];
		if (!profile || !name) usage();
		if (profile.scopes.includes("admin")) {
			console.error(`The ${profileName} preset is admin; agents never get admin. Use agent-editor or agent-readonly.`);
			process.exit(2);
		}
		const expiresAt = new Date(Date.now() + parseLifetime(option("--expires"), profile.days));
		const { token, agent, info } = await agents.create(name, profile.scopes, expiresAt, option("--role") === "author" ? 30 : 40);
		console.log(`Created agent account "${agent.name}" (id ${agent.id}, role ${agent.role === 40 ? "editor" : "author"}, ${agent.email})`);
		console.log(`Token ${info.prefix}… (${profileName}) expires ${info.expiresAt}; scopes: ${info.scopes.join(" ")}`);
		console.log(`\n${token}\n\nThis is the only time the token is shown. Store it in the agent's secret store.`);
		console.log(`Its publishes go to an editor for approval; disable the account to cut it off: astro-cms agent disable --base ${base} --id ${agent.id}`);
	} else if (command === "list") {
		for (const a of await agents.list()) {
			console.log(`${a.id}  ${a.name}${a.disabled ? "  [DISABLED]" : ""}  role ${a.role}`);
			for (const t of a.tokens) console.log(`    ${t.prefix}…  ${t.scopes.join(" ")}  expires ${t.expiresAt ?? "never"}  last used ${t.lastUsedAt ?? "never"}`);
		}
	} else if (command === "disable") {
		const id = option("--id");
		if (!id) usage();
		await agents.disable(id);
		console.log(`Disabled agent ${id}; its tokens no longer work.`);
	} else {
		usage();
	}
	process.exit(process.exitCode ?? 0);
}

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
