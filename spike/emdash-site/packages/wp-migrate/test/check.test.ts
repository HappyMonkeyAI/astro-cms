import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { goLiveCheck } from "../src/check.ts";
import type { McpClient } from "../src/mcp-client.ts";
import { describePrepared, prepareExport } from "../src/prepare.ts";
import type { RestClient } from "../src/rest-client.ts";

function site(opts: { pluginIssues?: unknown[]; entries?: { slug: string; data: unknown; draftRevisionId?: string }[]; pluginMissing?: boolean; scanError?: string; collections?: Record<string, unknown>[] }) {
	const posted: { path: string; body: unknown }[] = [];
	const rest: RestClient = {
		async get() {
			throw new Error("unused");
		},
		async post(path, body) {
			posted.push({ path, body });
			if (opts.pluginMissing) throw new Error("POST /plugins/migration-guard/scan -> 404");
			if (opts.scanError) throw new Error(opts.scanError);
			return path.endsWith("/scan") ? { ok: true, scanned: opts.entries?.length ?? 0 } : { ok: true, items: opts.pluginIssues ?? [] };
		},
	};
	const entries = opts.entries ?? [];
	const mcp: McpClient = {
		async call(tool: string, args: any) {
			if (tool === "schema_list_collections") return { items: opts.collections ?? [{ slug: "posts" }] };
			if (tool === "content_list") return { items: args.status === "published" ? entries.map((e) => ({ id: e.slug })) : [] };
			if (tool === "content_get") return { item: { status: "published", ...entries.find((e) => e.slug === args.id) } };
			throw new Error(tool);
		},
	};
	return { rest, mcp, posted };
}

test("ready when the plugin reports nothing and no markers remain; legacy hosts are handed to the plugin", async () => {
	const s = site({ entries: [{ slug: "a", data: { title: "A", content: [] } }] });
	const report = await goLiveCheck({ ...s, legacyHosts: ["old.test"] });
	assert.equal(report.ready, true);
	assert.deepEqual(s.posted[0], { path: "/plugins/migration-guard/scan", body: { legacyHosts: ["old.test"] } });
});

test("not ready when migration-guard flags entries or markers are left", async () => {
	const s = site({
		pluginIssues: [{ collection: "posts", slug: "contact", shortcodes: { "contact-form-7": 1 }, legacyUrls: 2 }],
		entries: [{ slug: "b", data: { content: [{ _type: "block", children: [{ text: "x {{wpm:9:0}}" }] }] } }],
	});
	const report = await goLiveCheck({ ...s, legacyHosts: [] });
	assert.equal(report.ready, false);
	assert.deepEqual(
		report.issues.map((i) => [i.slug, i.problem]),
		[
			["contact", "1× [contact-form-7], 2 legacy-host URL(s)"],
			["b", "1 unconverted shortcode marker(s)"],
		],
	);
});

test("published entries with unpublished changes are listed for review without blocking", async () => {
	const s = site({ entries: [{ slug: "edited", data: { title: "E" }, draftRevisionId: "R1" }, { slug: "clean", data: { title: "C" } }] });
	const report = await goLiveCheck({ ...s, legacyHosts: [] });
	assert.equal(report.ready, true);
	assert.deepEqual(report.pendingDrafts, [{ collection: "posts", slug: "edited" }]);
});

test("a site without migration-guard fails loudly instead of reporting ready", async () => {
	await assert.rejects(goLiveCheck({ ...site({ pluginMissing: true }), legacyHosts: [] }), /migration-guard isn't available/);
});

test("a scan that errors is reported as a scan failure, not a missing plugin", async () => {
	const scanError = "POST /plugins/migration-guard/scan -> 400: duplicate key value violates unique constraint";
	await assert.rejects(goLiveCheck({ ...site({ scanError }), legacyHosts: [] }), /^Error: migration-guard scan failed, .*duplicate key/);
});

test("issues in collections visitors can't reach are listed for review, not blocking", async () => {
	const flagged = (collection: string, slug: string) => ({ collection, entryId: slug, entrySlug: slug, legacyUrls: 2 });
	const report = await goLiveCheck({
		...site({
			pluginIssues: [flagged("elementor_library", "podcast-template"), flagged("hidden", "h"), flagged("posts", "episode")],
			collections: [
				{ slug: "posts", urlPattern: "/posts/{slug}" },
				{ slug: "elementor_library" }, // EmDash omits urlPattern when there is none
				{ slug: "hidden", urlPattern: "/hidden/{slug}", routable: false },
			],
		}),
		legacyHosts: [],
	});
	assert.equal(report.ready, false, "the public post still blocks");
	assert.deepEqual(report.issues.map((i) => i.collection), ["posts"]);
	assert.deepEqual(report.notPublic.map((i) => i.collection), ["elementor_library", "hidden"]);

	const onlyTemplate = await goLiveCheck({
		...site({ pluginIssues: [flagged("elementor_library", "podcast-template")], collections: [{ slug: "posts", urlPattern: "/posts/{slug}" }, { slug: "elementor_library", urlPattern: "" }] }),
		legacyHosts: [],
	});
	assert.equal(onlyTemplate.ready, true);
	assert.equal(onlyTemplate.notPublic.length, 1);
});

test("fails closed: a collection without URL information, or one not in the list, still blocks", async () => {
	const flagged = { collection: "mystery", entryId: "m", entrySlug: "m", legacyUrls: 1 };
	for (const collections of [[{ slug: "mystery" }], [{ slug: "posts", urlPattern: "/posts/{slug}" }]]) {
		const report = await goLiveCheck({ ...site({ pluginIssues: [flagged], collections }), legacyHosts: [] });
		assert.equal(report.ready, false);
		assert.deepEqual(report.notPublic, []);
	}
});

test("go-live issues use the entry slug migration-guard records", async () => {
	const report = await goLiveCheck({ ...site({ pluginIssues: [{ collection: "pages", entryId: "01X", entrySlug: "about", shortcodes: { gallery: 1 }, legacyUrls: 0 }] }), legacyHosts: [] });
	assert.deepEqual(report.issues, [{ collection: "pages", slug: "about", problem: "1× [gallery]" }]);
});

test("prepareExport on the theme unit test data gathers every pass input", () => {
	const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");
	const prepared = prepareExport(fixture, "themeunittestdata.wordpress.xml");
	assert.equal(prepared.preflight.protected.length, 1);
	assert.equal(prepared.shortcodes.filter((e) => e.data).length, 25);
	assert.equal(prepared.permalinks.length, 79);
	assert.equal(prepared.menus.length, 5);
	assert.equal(prepared.mediaMetadata.length, 37);
	assert.ok(prepared.preflight.decodedSlugs.length >= 2);
	assert.match(describePrepared(prepared).join("\n"), /25 shortcode\(s\) will be converted/);
});
