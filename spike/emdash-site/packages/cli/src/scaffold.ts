/**
 * `astro-cms plugin new`: generate a sandboxed EmDash plugin from templates/plugin,
 * with the toolchain fixes and lessons from migration-guard and agent-guard built in
 * (current plugin-test, no network publisher lookup, no symlinks, `npm run check`).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_DIR = fileURLToPath(new URL("../templates/plugin/", import.meta.url));

export interface PluginVars {
	slug: string;
	title: string;
	description: string;
	publisher: string;
	author: string;
	securityEmail: string;
}

const SLUG = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;

export function validateSlug(slug: string): string | undefined {
	if (!SLUG.test(slug)) return "slug must be 3-50 characters of lowercase letters, digits and hyphens, starting with a letter";
	if (slug.includes("--")) return "slug can't contain consecutive hyphens";
	return undefined;
}

/** `cookie-consent` → `Cookie consent` */
export function titleFromSlug(slug: string): string {
	const words = slug.split("-");
	return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

export function defaults(slug: string, overrides: Partial<PluginVars> = {}): PluginVars {
	return {
		slug,
		title: overrides.title ?? titleFromSlug(slug),
		description: overrides.description ?? `${titleFromSlug(slug)} for astro-cms sites`,
		publisher: overrides.publisher ?? "did:web:example.com",
		author: overrides.author ?? "astro-cms",
		securityEmail: overrides.securityEmail ?? "security@example.com",
	};
}

/** Fill `{{name}}` placeholders, escaping values for the JSON/JSONC files they land in. */
export function render(text: string, vars: PluginVars, json: boolean): string {
	return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
		const value = (vars as unknown as Record<string, string>)[key];
		if (value === undefined) throw new Error(`Unknown template placeholder ${whole}`);
		return json ? JSON.stringify(value).slice(1, -1) : value;
	});
}

/** `package.json.tmpl` → `package.json`; `gitignore.tmpl` → `.gitignore` (npm drops real .gitignore files). */
export function outputName(templatePath: string): string {
	const name = templatePath.replace(/\.tmpl$/, "");
	return name === "gitignore" || name.endsWith("/gitignore") || name.endsWith("\\gitignore") ? name.replace(/gitignore$/, ".gitignore") : name;
}

async function walk(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(path)));
		else if (entry.isFile()) out.push(path);
	}
	return out;
}

export async function scaffoldPlugin(targetDir: string, vars: PluginVars, templateDir = TEMPLATE_DIR): Promise<string[]> {
	const problem = validateSlug(vars.slug);
	if (problem) throw new Error(problem);
	if (await stat(targetDir).then(() => true, () => false)) throw new Error(`${targetDir} already exists`);
	const written: string[] = [];
	for (const file of await walk(templateDir)) {
		const rel = outputName(relative(templateDir, file));
		const target = join(targetDir, rel);
		const text = await readFile(file, "utf8");
		const json = /\.jsonc?$/.test(rel);
		await mkdir(join(target, ".."), { recursive: true });
		await writeFile(target, file.endsWith(".tmpl") ? render(text, vars, json) : text);
		written.push(rel.replace(/\\/g, "/"));
	}
	return written.sort();
}
