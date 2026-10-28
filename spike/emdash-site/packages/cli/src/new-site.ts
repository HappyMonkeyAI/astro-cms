/**
 * `astro-cms new <name>`: generate a deployable site folder from templates/site (compose recipe,
 * .env with fresh secrets, Caddy for HTTPS, backup and restore scripts). SPEC §5.7.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { outputName } from "./scaffold.ts";

export const SITE_TEMPLATE_DIR = fileURLToPath(new URL("../templates/site/", import.meta.url));
export const DEFAULT_IMAGE = "astro-cms/site:spike";

export interface SiteVars {
	siteName: string;
	domain: string;
	port: string;
	image: string;
	siteUrl: string;
	postgresPassword: string;
	encryptionKey: string;
	setupToken: string;
	created: string;
}

const NAME_RE = /^[a-z][a-z0-9-]{1,40}[a-z0-9]$/;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IMAGE_RE = /^[a-z0-9][\w.\-/:@]{2,200}$/i;

export function validateSiteOptions(o: { name: string; domain?: string; port?: string; image?: string }): string | undefined {
	if (!NAME_RE.test(o.name)) return "name must be 3-42 lowercase letters, digits and hyphens, starting with a letter (it becomes the compose project name)";
	if (o.domain !== undefined && !DOMAIN_RE.test(o.domain)) return `"${o.domain}" isn't a domain name like cms.example.com`;
	if (o.port !== undefined && !(/^\d{2,5}$/.test(o.port) && Number(o.port) >= 1024 && Number(o.port) <= 65535)) return "port must be 1024-65535";
	if (o.image !== undefined && !IMAGE_RE.test(o.image)) return `"${o.image}" isn't an image reference`;
	return undefined;
}

/** EmDash's key format: `emdash_enc_v1_` + 32 random bytes as unpadded base64url (43 chars). */
export function encryptionKey(): string {
	return `emdash_enc_v1_${randomBytes(32).toString("base64url")}`;
}

export function siteVars(o: { name: string; domain?: string; port?: string; image?: string }, now = new Date()): SiteVars {
	const port = o.port ?? "4321";
	const domain = o.domain ?? "localhost";
	return {
		siteName: o.name,
		domain,
		port,
		image: o.image ?? DEFAULT_IMAGE,
		siteUrl: o.domain ? `https://${o.domain}` : `http://localhost:${port}`,
		// Hex: safe unescaped inside DATABASE_URL
		postgresPassword: randomBytes(24).toString("hex"),
		encryptionKey: encryptionKey(),
		setupToken: randomBytes(24).toString("base64url"),
		created: now.toISOString().slice(0, 10),
	};
}

function fill(text: string, vars: SiteVars): string {
	return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
		const value = (vars as unknown as Record<string, string>)[key];
		if (value === undefined) throw new Error(`Unknown template placeholder ${whole}`);
		return value;
	});
}

/** `env.tmpl` → `.env`, `gitignore.tmpl` → `.gitignore`, other `.tmpl` files lose the suffix. */
function siteOutputName(file: string): string {
	return file === "env.tmpl" ? ".env" : outputName(file);
}

export async function scaffoldSite(targetDir: string, vars: SiteVars, templateDir = SITE_TEMPLATE_DIR): Promise<string[]> {
	if (await stat(targetDir).then(() => true, () => false)) throw new Error(`${targetDir} already exists`);
	await mkdir(targetDir, { recursive: true });
	const written: string[] = [];
	for (const file of (await readdir(templateDir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)) {
		const text = await readFile(join(templateDir, file), "utf8");
		const target = siteOutputName(file);
		// Shell scripts must keep LF line endings even when generated on Windows
		const body = (file.endsWith(".tmpl") ? fill(text, vars) : text).replace(/\r\n/g, "\n");
		await writeFile(join(targetDir, target), body, { mode: target === ".env" ? 0o600 : file.endsWith(".sh") ? 0o755 : 0o644 });
		written.push(target);
	}
	return written.sort();
}
