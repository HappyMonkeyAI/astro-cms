import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { encryptionKey, scaffoldSite, siteVars, validateSiteOptions } from "../src/new-site.ts";

test("validates name, domain, port and image", () => {
	assert.equal(validateSiteOptions({ name: "acme-law", domain: "cms.acme-law.co.uk", port: "4400", image: "ghcr.io/agency/astro-cms:0.1.0" }), undefined);
	for (const bad of [{ name: "Acme" }, { name: "a" }, { name: "acme", domain: "not a domain" }, { name: "acme", domain: "acme.com/x" }, { name: "acme", port: "80" }, { name: "acme", image: "bad image; rm -rf" }]) {
		assert.ok(validateSiteOptions(bad as never), JSON.stringify(bad));
	}
});

test("secrets are fresh and in the right format", () => {
	assert.match(encryptionKey(), /^emdash_enc_v1_[A-Za-z0-9_-]{43}$/);
	const a = siteVars({ name: "acme", domain: "cms.acme.com" });
	const b = siteVars({ name: "acme", domain: "cms.acme.com" });
	assert.notEqual(a.postgresPassword, b.postgresPassword);
	assert.notEqual(a.setupToken, b.setupToken);
	assert.match(a.postgresPassword, /^[0-9a-f]{48}$/, "hex, so it needs no escaping in DATABASE_URL");
	assert.ok(a.setupToken.length >= 24, "setup-guard ignores tokens shorter than 24");
	assert.equal(a.siteUrl, "https://cms.acme.com");
	assert.equal(siteVars({ name: "acme", port: "4400" }).siteUrl, "http://localhost:4400");
});

test("scaffoldSite writes the recipe with secrets only in .env", async () => {
	const dir = join(mkdtempSync(join(tmpdir(), "site-new-")), "acme");
	const vars = siteVars({ name: "acme", domain: "cms.acme.com" });
	const files = await scaffoldSite(dir, vars);
	assert.deepEqual(files, [".env", ".gitignore", "Caddyfile", "README.md", "backup.sh", "compose.yaml", "restore.sh"]);
	const env = readFileSync(join(dir, ".env"), "utf8");
	for (const line of [`SITE_NAME=acme`, `DOMAIN=cms.acme.com`, `EMDASH_SITE_URL=https://cms.acme.com`, `POSTGRES_PASSWORD=${vars.postgresPassword}`, `EMDASH_ENCRYPTION_KEY=${vars.encryptionKey}`, `ASTRO_CMS_SETUP_TOKEN=${vars.setupToken}`]) {
		assert.ok(env.includes(`\n${line}\n`), line);
	}
	for (const file of files.filter((f) => f !== ".env")) {
		const text = readFileSync(join(dir, file), "utf8");
		assert.doesNotMatch(text, /\{\{\w+\}\}/, `placeholder left in ${file}`);
		for (const secret of [vars.postgresPassword, vars.encryptionKey, vars.setupToken]) assert.ok(!text.includes(secret), `secret leaked into ${file}`);
		assert.ok(!text.includes("\r\n"), `${file} has CRLF line endings`);
	}
	assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /^\.env$/m);
	await assert.rejects(scaffoldSite(dir, vars), /already exists/);
});
