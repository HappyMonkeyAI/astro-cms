import assert from "node:assert/strict";
import { test } from "node:test";

import { createBaselineRevisions, needsBaseline, pickUnchangedField } from "../src/baseline.ts";
import type { McpClient } from "../src/mcp-client.ts";

test("pickUnchangedField prefers title, else the first scalar field", () => {
	assert.deepEqual(pickUnchangedField({ title: "Hi", content: [] }), ["title", "Hi"]);
	assert.deepEqual(pickUnchangedField({ content: [], name: "Mug", price: 3 }), ["name", "Mug"]);
	assert.equal(pickUnchangedField({ content: [] }), undefined);
});

test("needsBaseline only for entries with no revision of any kind", () => {
	assert.equal(needsBaseline({}, 0), true);
	assert.equal(needsBaseline({ liveRevisionId: "r" }, 0), false);
	assert.equal(needsBaseline({ draftRevisionId: "r" }, 0), false);
	assert.equal(needsBaseline({}, 1), false);
});

/** In-memory stand-in for EmDash's MCP tools: update makes a draft revision, publish makes it live. */
function fakeSite(entries: { id: string; slug: string; status: string; live?: string }[]) {
	const calls: string[] = [];
	const state = new Map(entries.map((e) => [e.id, { ...e, draft: undefined as string | undefined, revs: e.live ? 1 : 0 }]));
	let n = 0;
	const view = (e: any) => ({ item: { id: e.id, slug: e.slug, status: e.status, liveRevisionId: e.live, draftRevisionId: e.draft, data: { title: e.slug } }, _rev: `rev-${e.id}` });
	const mcp: McpClient = {
		async call(tool: string, args: any) {
			calls.push(`${tool}:${args.id ?? args.collection ?? ""}`);
			const e = state.get(args.id) ?? [...state.values()].find((x) => x.slug === args.id);
			switch (tool) {
				case "schema_list_collections":
					return { items: [{ slug: "posts" }] };
				case "content_list":
					return { items: [...state.values()].filter((x) => x.status === args.status).map((x) => ({ id: x.id })) };
				case "content_get":
					return view(e);
				case "revision_list":
					return { items: Array.from({ length: e!.revs }, () => ({})) };
				case "content_update":
					e!.draft = `R${n++}`;
					e!.revs++;
					return {};
				case "content_publish":
					e!.live = e!.draft;
					e!.draft = undefined;
					return {};
			}
			throw new Error(`unexpected ${tool}`);
		},
	};
	return { mcp, calls, state };
}

test("createBaselineRevisions snapshots entries without history, publishes only published ones", async () => {
	const site = fakeSite([
		{ id: "a", slug: "pub", status: "published" },
		{ id: "b", slug: "drf", status: "draft" },
		{ id: "c", slug: "sch", status: "scheduled" },
		{ id: "d", slug: "old", status: "published", live: "R-existing" },
	]);
	const report = await createBaselineRevisions({ mcp: site.mcp });
	assert.deepEqual(
		report.created.map((o) => [o.slug, o.published, Boolean(o.revisionId)]).sort(),
		[
			["drf", false, true],
			["pub", true, true],
			["sch", false, true],
		],
	);
	assert.equal(report.alreadyHadHistory, 1);
	assert.deepEqual(report.failed, []);
	assert.equal(site.calls.filter((c) => c.startsWith("content_publish")).length, 1, "scheduled and draft entries are never published");
	assert.ok(site.state.get("a")!.live, "the published entry's snapshot is now its live revision");
	assert.equal(site.state.get("c")!.live, undefined, "the scheduled entry keeps a draft revision only");
});

test("a re-run creates nothing", async () => {
	const site = fakeSite([{ id: "a", slug: "pub", status: "published" }]);
	await createBaselineRevisions({ mcp: site.mcp });
	const again = await createBaselineRevisions({ mcp: site.mcp });
	assert.equal(again.created.length, 0);
	assert.equal(again.alreadyHadHistory, 1);
});
