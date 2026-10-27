import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defaults, outputName, render, scaffoldPlugin, titleFromSlug, validateSlug } from "../src/scaffold.ts";

test("validateSlug accepts plugin-style slugs only", () => {
	assert.equal(validateSlug("cookie-consent"), undefined);
	for (const bad of ["Cookie", "1st", "a", "x--y", "trailing-", "has_underscore", "way-too-long-".repeat(5)]) assert.ok(validateSlug(bad), bad);
});

test("titles, output names and JSON-safe rendering", () => {
	assert.equal(titleFromSlug("cookie-consent"), "Cookie consent");
	assert.equal(outputName("package.json.tmpl"), "package.json");
	assert.equal(outputName("gitignore.tmpl"), ".gitignore");
	assert.equal(outputName("src/plugin.ts.tmpl"), "src/plugin.ts");
	const vars = defaults("x-y", { description: 'Says "hi"\nand more' });
	assert.equal(render('{"d": "{{description}}"}', vars, true), '{"d": "Says \\"hi\\"\\nand more"}');
	assert.throws(() => render("{{nope}}", vars, false), /Unknown template placeholder/);
});

test("scaffoldPlugin writes a complete plugin with every placeholder filled", async () => {
	const dir = join(mkdtempSync(join(tmpdir(), "plugin-new-")), "cookie-consent");
	const files = await scaffoldPlugin(dir, defaults("cookie-consent", { description: "Cookie banner" }));
	for (const expected of [".claude/CLAUDE.md", ".gitignore", "AGENTS.md", "README.md", "emdash-plugin.jsonc", "package.json", "skills/creating-plugins/ASTRO-CMS.md", "skills/creating-plugins/SKILL.md", "src/plugin.ts", "tests/plugin.test.ts", "tsconfig.json", "vitest.config.ts"]) {
		assert.ok(files.includes(expected), `missing ${expected}`);
	}
	for (const file of files) assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), /\{\{\w+\}\}/, `placeholder left in ${file}`);
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	assert.equal(pkg.name, "cookie-consent");
	assert.equal(pkg.devDependencies["@emdash-cms/plugin-test"], "^0.2.10");
	assert.match(readFileSync(join(dir, "emdash-plugin.jsonc"), "utf8"), /"slug": "cookie-consent"/);
	await assert.rejects(scaffoldPlugin(dir, defaults("cookie-consent")), /already exists/);
});
