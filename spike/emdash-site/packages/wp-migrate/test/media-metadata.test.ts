import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { McpClient } from "../src/mcp-client.ts";
import { fixMediaMetadata, planMediaUpdate, readAttachmentMetadata } from "../src/media-metadata.ts";

const xml = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");

function item(fields: string): string {
	return `<item><title>T</title><wp:post_id>5</wp:post_id><wp:post_type>attachment</wp:post_type>${fields}</item>`;
}

test("reads every attachment, 28 with alt", () => {
	const all = readAttachmentMetadata(xml);
	assert.equal(all.length, 37);
	assert.equal(all.filter((m) => m.alt).length, 28);
	const canola = all.find((m) => m.wpId === 611);
	assert.equal(canola?.title, "canola2");
	assert.equal(canola?.alt, "canola");
	assert.ok(canola?.caption?.length);
});

test("handles CDATA and plain, strips caption tags, empty becomes undefined", () => {
	const doc =
		item(`<excerpt:encoded><![CDATA[<p> Hello <b>there</b> </p>]]></excerpt:encoded><wp:postmeta><wp:meta_key><![CDATA[_wp_attachment_image_alt]]></wp:meta_key><wp:meta_value><![CDATA[ A cat ]]></wp:meta_value></wp:postmeta>`) +
		item(`<excerpt:encoded></excerpt:encoded><wp:postmeta><wp:meta_key>_wp_attachment_image_alt</wp:meta_key><wp:meta_value>plain alt</wp:meta_value></wp:postmeta>`) +
		item(`<excerpt:encoded><![CDATA[]]></excerpt:encoded>`) +
		`<item><wp:post_id>9</wp:post_id><wp:post_type>post</wp:post_type></item>`;
	const [a, b, c, ...rest] = readAttachmentMetadata(doc);
	assert.equal(rest.length, 0);
	assert.deepEqual([a.alt, a.caption], ["A cat", "Hello there"]);
	assert.deepEqual([b.alt, b.caption], ["plain alt", undefined]);
	assert.deepEqual([c.alt, c.caption], [undefined, undefined]);
});

test("planner fills only empty fields", () => {
	const meta = { wpId: 1, alt: "new alt", caption: "new caption" };
	assert.deepEqual(planMediaUpdate(meta, {}), { alt: "new alt", caption: "new caption" });
	assert.deepEqual(planMediaUpdate(meta, { alt: "", caption: null }), { alt: "new alt", caption: "new caption" });
	assert.deepEqual(planMediaUpdate(meta, { alt: "editor alt", caption: " " }), { caption: "new caption" });
	assert.equal(planMediaUpdate(meta, { alt: "x", caption: "y" }), undefined);
	assert.equal(planMediaUpdate({ wpId: 1, title: "only title" }, {}), undefined);
});

function fakeMcp(store: Record<string, { alt?: string; caption?: string }>, failOn?: string) {
	const calls: { tool: string; args: any }[] = [];
	const mcp: McpClient = {
		async call(tool, args: any) {
			calls.push({ tool, args });
			if (args.id === failOn) throw new Error("boom");
			if (tool === "media_get") return { item: { id: args.id, ...store[args.id] } };
			return {};
		},
	};
	return { mcp, calls };
}

const media = (wpId: number) => ({ wpId, originalUrl: `http://x/${wpId}.jpg`, newUrl: `/m/${wpId}`, mediaId: `m${wpId}` });

test("orchestrator updates, skips, counts and isolates errors", async () => {
	const { mcp, calls } = fakeMcp({ m1: {}, m2: { alt: "set", caption: "set" }, m3: {}, m5: {} }, "m5");
	const report = await fixMediaMetadata({
		mcp,
		metadata: [
			{ wpId: 1, alt: "a1", caption: "c1" },
			{ wpId: 2, alt: "a2", caption: "c2" },
			{ wpId: 3, caption: "c3" },
			{ wpId: 5, alt: "a5" },
		],
		media: [media(1), media(2), media(3), media(4), media(5)],
	});
	assert.deepEqual(
		calls.filter((c) => c.tool === "media_update").map((c) => c.args),
		[
			{ id: "m1", alt: "a1", caption: "c1" },
			{ id: "m3", caption: "c3" },
		],
	);
	assert.equal(report.updated, 2);
	assert.equal(report.skippedAlreadySet, 1);
	assert.equal(report.noMetadata, 1);
	assert.equal(report.missingAlt, 1); // m3 has a caption only
	assert.deepEqual(report.errors, [{ mediaId: "m5", error: "boom" }]);
});

test("dry run sends no updates", async () => {
	const { mcp, calls } = fakeMcp({ m1: {} });
	const report = await fixMediaMetadata({ mcp, metadata: [{ wpId: 1, alt: "a" }], media: [media(1)], dryRun: true });
	assert.equal(report.updated, 1);
	assert.equal(calls.some((c) => c.tool === "media_update"), false);
});
