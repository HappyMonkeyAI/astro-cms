import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildBlocks } from "../src/blocks.ts";
import { createMediaResolver } from "../src/media.ts";
import { replaceMarkers, type PtBlock } from "../src/portable-text.ts";
import { findShortcodes, parseAttrs } from "../src/shortcode-parse.ts";
import { extractShortcodes, SUPPORTED_SHORTCODES } from "../src/shortcodes.ts";
import { getField, readItems } from "../src/wxr.ts";

const post = (id: number, content: string, slug = `p${id}`) =>
	`<item><title>T</title><wp:post_id>${id}</wp:post_id><wp:post_name>${slug}</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type><content:encoded><![CDATA[${content}]]></content:encoded></item>`;
const attachment = (id: number, parent: number, url: string, menuOrder = 0) =>
	`<item><title>Img ${id}</title><wp:post_id>${id}</wp:post_id><wp:post_parent>${parent}</wp:post_parent><wp:menu_order>${menuOrder}</wp:menu_order><wp:post_type>attachment</wp:post_type><wp:attachment_url>${url}</wp:attachment_url></item>`;
const wxr = (...items: string[]) => `<rss><channel>${items.join("\n")}</channel></rss>`;

test("parseAttrs handles quoted, unquoted and positional values like WordPress", () => {
	assert.deepEqual(parseAttrs(` columns="2" ids='1,2' size=large https://x.test/a.mp3`), {
		columns: "2",
		ids: "1,2",
		size: "large",
		"0": "https://x.test/a.mp3",
	});
});

test("findShortcodes skips [[escaped]] shortcodes and reads enclosed content", () => {
	const found = findShortcodes(`a [[gallery]] b [caption id="x"]<img src="i.jpg"> Hi[/caption] [gallery ids="3"]`, SUPPORTED_SHORTCODES);
	assert.deepEqual(
		found.map((f) => [f.name, f.content ?? null]),
		[
			["caption", `<img src="i.jpg"> Hi`],
			["gallery", null],
		],
	);
});

test("extractShortcodes replaces supported shortcodes with markers and records their data", () => {
	const source = wxr(
		post(
			5,
			`Intro [caption id="attachment_9" align="alignright" width="300"]<a href="https://old.test/big.jpg"><img class="wp-image-9" src="https://old.test/a-300x200.jpg" alt="A &amp; B" /></a> Look <em>here</em>.[/caption] after
[gallery columns="2"]
[audio https://old.test/song.mp3]
[foo bar] [gallery ids="404"]`,
		),
		attachment(9, 5, "https://old.test/a.jpg", 2),
		attachment(8, 5, "https://old.test/b.png", 1),
		attachment(7, 5, "https://old.test/doc.pdf", 0),
	);
	const { xml, entries } = extractShortcodes(source);
	const content = getField(readItems(xml)[0].raw, "content:encoded");
	assert.equal(
		content,
		`Intro {{wpm:5:0}} after\n{{wpm:5:1}}\n{{wpm:5:2}}\n[foo bar] [gallery ids="404"]`,
		"unsupported and unresolvable shortcodes stay as text",
	);
	assert.deepEqual(entries[0].data, {
		kind: "caption",
		image: { attachmentId: 9, url: "https://old.test/a-300x200.jpg", alt: "A & B" },
		caption: "Look here.",
		align: "right",
		link: "https://old.test/big.jpg",
	});
	assert.deepEqual(
		entries[1].data?.kind === "gallery" && entries[1].data.images.map((i) => i.attachmentId),
		[8, 9],
		"attached images by menu_order, PDFs excluded",
	);
	assert.deepEqual(entries[2].data, { kind: "audio", media: { attachmentId: undefined, url: "https://old.test/song.mp3" } });
	assert.equal(entries[3].problem, "gallery with no images in the export");
});

test("replaceMarkers splits a paragraph at the marker and keeps formatting and links", () => {
	const blocks: PtBlock[] = [
		{
			_type: "block",
			_key: "b1",
			style: "normal",
			markDefs: [
				{ _key: "l1", _type: "link", href: "https://a.test" },
				{ _key: "l2", _type: "link", href: "https://b.test" },
			],
			children: [
				{ _type: "span", _key: "s1", text: "Before ", marks: ["l1"] },
				{ _type: "span", _key: "s2", text: "mid {{wpm:5:0}}\n\n after", marks: [] },
				{ _type: "span", _key: "s3", text: " end", marks: ["l2"] },
			],
		},
		{ _type: "htmlBlock", _key: "h1", html: " {{wpm:5:1}} " },
		{ _type: "image", _key: "i1" },
	];
	let n = 0;
	const result = replaceMarkers(blocks, (m) => (m === "{{wpm:5:9}}" ? undefined : [{ _type: "gallery", _key: `g-${m}` }]), () => `k${n++}`);
	assert.deepEqual(
		result.blocks.map((b) => [b._type, b._key, b.children?.map((c) => c.text).join("|"), b.markDefs?.map((d) => d._key)]),
		[
			["block", "b1", "Before |mid", ["l1"]],
			["gallery", "g-{{wpm:5:0}}", undefined, undefined],
			["block", "k1", "after| end", ["l2"]],
			["gallery", "g-{{wpm:5:1}}", undefined, undefined],
			["image", "i1", undefined, undefined],
		],
	);
	assert.deepEqual(result.replaced, ["{{wpm:5:0}}", "{{wpm:5:1}}"]);
	assert.deepEqual(result.stuck, []);
});

test("replaceMarkers leaves unknown markers in place and reports them", () => {
	const blocks: PtBlock[] = [{ _type: "block", _key: "b", children: [{ _type: "span", _key: "s", text: "x {{wpm:1:0}} y" }] }];
	const result = replaceMarkers(blocks, () => undefined, () => "k");
	assert.equal(result.blocks[0].children?.map((c) => c.text).join(""), "x {{wpm:1:0}} y");
	assert.deepEqual(result.stuck, ["{{wpm:1:0}}"]);
});

test("media resolver matches by attachment id, exact URL, then size variant", () => {
	const resolve = createMediaResolver([
		{ wpId: 9, originalUrl: "https://old.test/a.jpg", newUrl: "/m/a.jpg", mediaId: "M9" },
		{ wpId: 3, originalUrl: "http://old.test/song.mp3", newUrl: "/m/song.mp3", mediaId: "M3" },
	]);
	assert.equal(resolve({ attachmentId: 9, url: "zzz" }).mediaId, "M9");
	assert.equal(resolve({ url: "https://old.test/song.mp3" }).mediaId, "M3", "scheme-insensitive");
	assert.equal(resolve({ url: "https://old.test/a-150x150.jpg" }).mediaId, "M9", "size variant");
	assert.deepEqual(resolve({ url: "https://other.test/x.jpg" }), { url: "https://other.test/x.jpg", local: false });
});

test("buildBlocks produces EmDash block shapes and reports media left on the old host", () => {
	const external: string[] = [];
	const resolve = createMediaResolver([{ wpId: 9, originalUrl: "https://old.test/a.jpg", newUrl: "/m/a.jpg", mediaId: "M9" }]);
	const [image] = buildBlocks(
		{ kind: "caption", image: { attachmentId: 9, url: "https://old.test/a-300x200.jpg" }, caption: "Hi", align: "left" },
		resolve,
		() => "k",
		(u) => external.push(u),
	);
	assert.deepEqual(image, {
		_type: "image",
		_key: "k",
		asset: { _type: "reference", _ref: "M9", url: "/m/a.jpg" },
		alt: undefined,
		caption: "Hi",
		alignment: "left",
		link: undefined,
	});
	const [audio] = buildBlocks({ kind: "audio", media: { url: "https://cdn.test/x.mp3" } }, resolve, () => "k", (u) => external.push(u));
	assert.deepEqual(audio, { _type: "embed", _key: "k", url: "https://cdn.test/x.mp3", provider: "audio" });
	assert.deepEqual(external, ["https://cdn.test/x.mp3"]);
});

test("theme unit test data: every supported shortcode is converted or explained", () => {
	const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");
	const { xml, entries } = extractShortcodes(fixture);
	const kinds = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.data?.kind ?? `problem: ${e.problem}`]: (acc[e.data?.kind ?? `problem: ${e.problem}`] ?? 0) + 1 }), {});
	assert.deepEqual(kinds, { gallery: 12, caption: 12, audio: 1 });
	const left = findShortcodes(
		readItems(xml).map((i) => getField(i.raw, "content:encoded")).join("\n"),
		SUPPORTED_SHORTCODES,
	);
	assert.equal(left.length, 0, "no supported shortcode remains in the prepared export");
});
