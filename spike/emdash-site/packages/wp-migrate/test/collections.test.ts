import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectionsFromAnalysis, readImportCollections, toCollection } from "../src/collections.ts";
import { fixShortcodes } from "../src/fix-shortcodes.ts";
import type { McpClient } from "../src/mcp-client.ts";
import { planRedirects } from "../src/redirects.ts";

test("toCollection follows EmDash's importer: known types pluralised, others keep their post type name", () => {
	assert.deepEqual(
		["post", "page", "faq", "portfolio", "team", "elementor_library", "oceanwp_library", "service"].map((t) => toCollection(t)),
		["posts", "pages", "faqs", "portfolio", "team", "elementor_library", "oceanwp_library", "service"],
	);
	assert.equal(toCollection("service", { service: "services" }), "services", "the import step's record wins");
});

test("the import step's analysis records the collection per post type", async () => {
	const analysis = { postTypes: [{ name: "page", suggestedCollection: "pages" }, { name: "elementor_library", suggestedCollection: "elementor_library" }, { name: "x" }] };
	assert.deepEqual(collectionsFromAnalysis(analysis), { page: "pages", elementor_library: "elementor_library" });

	const dir = await mkdtemp(join(tmpdir(), "wpm-collections-"));
	assert.deepEqual(await readImportCollections(dir), {}, "no import step yet");
	await mkdir(join(dir, "import"));
	await writeFile(join(dir, "import", "1-analysis.json"), JSON.stringify(analysis));
	assert.deepEqual(await readImportCollections(dir), { page: "pages", elementor_library: "elementor_library" });
});

test("shortcodes in a page-builder library template are fixed in the collection EmDash imported them into", async () => {
	const asked: string[] = [];
	const mcp: McpClient = {
		async call(tool: string, args: any) {
			if (tool === "content_get") {
				asked.push(args.collection);
				if (args.collection !== "elementor_library") throw new Error(`collection not found: ${args.collection}`);
				return { item: { status: "draft", data: { content: [{ _type: "block", _key: "a", children: [{ _type: "span", _key: "s", text: "{{wpm:7:0}}" }] }] } }, _rev: "r1" };
			}
			return { item: { status: "draft" }, _rev: "r2" };
		},
	};
	const [outcome] = await fixShortcodes({
		entries: [{ marker: "{{wpm:7:0}}", wpPostId: 7, postType: "elementor_library", slug: "contact-section", raw: "[contact-form-7 id=1]", data: { kind: "form", slug: "contact-form-1" } }],
		media: [],
		mcp,
		formIds: { "contact-form-1": "01FORM" },
	});
	assert.deepEqual(asked, ["elementor_library"]);
	assert.equal(outcome.error, undefined);
	assert.equal(outcome.replaced, 1);
});

test("redirects for a custom post type use EmDash's collection name", () => {
	const plan = planRedirects({
		permalinks: [{ wpId: 1, postType: "portfolio", slug: "case-study", status: "publish", link: "https://old.test/portfolio/case-study/", path: "/portfolio/case-study/" }],
		collections: {},
		urlPatterns: { portfolio: "/work/{slug}" },
		published: { portfolio: new Set(["case-study"]) },
		existingSources: new Set(),
	});
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.create.map((r) => [r.source, r.destination]), [["/portfolio/case-study/", "/work/case-study"]]);
});
