import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { findProtected, protectContent } from "../src/protect.ts";
import { getField, readItems, setField } from "../src/wxr.ts";

const item = (fields: Record<string, string>) =>
	`<item>${Object.entries(fields)
		.map(([k, v]) => `<${k}>${v}</${k}>`)
		.join("")}</item>`;
const wxr = (...items: string[]) => `<?xml version="1.0"?><rss><channel>${items.join("\n")}</channel></rss>`;

const passwordPost = item({
	title: "Secret",
	"wp:post_id": "7",
	"wp:post_name": "secret",
	"wp:status": "publish",
	"wp:post_type": "post",
	"wp:post_password": "enter",
});
const privatePage = item({
	title: "<![CDATA[Staff only]]>",
	"wp:post_id": "<![CDATA[8]]>",
	"wp:post_name": "<![CDATA[staff]]>",
	"wp:status": "<![CDATA[private]]>",
	"wp:post_type": "<![CDATA[page]]>",
	"wp:post_password": "<![CDATA[]]>",
});
const publicPost = item({
	title: "Hello",
	"wp:post_id": "9",
	"wp:post_name": "hello",
	"wp:status": "publish",
	"wp:post_type": "post",
	"wp:post_password": "",
});
const passwordDraft = item({
	title: "WIP",
	"wp:post_id": "10",
	"wp:post_name": "wip",
	"wp:status": "draft",
	"wp:post_type": "post",
	"wp:post_password": "x",
});
const attachment = item({ title: "img", "wp:post_id": "11", "wp:status": "inherit", "wp:post_type": "attachment", "wp:post_password": "x" });

test("getField unwraps CDATA and plain values; setField keeps the original form", () => {
	assert.equal(getField(privatePage, "wp:status"), "private");
	assert.equal(getField(passwordPost, "wp:status"), "publish");
	assert.match(setField(privatePage, "wp:status", "draft"), /<wp:status><!\[CDATA\[draft\]\]><\/wp:status>/);
	assert.match(setField(passwordPost, "wp:status", "draft"), /<wp:status>draft<\/wp:status>/);
	assert.throws(() => setField(passwordPost, "wp:nope", "x"), /no <wp:nope>/);
});

test("password-protected and private content becomes draft; nothing else changes", () => {
	const source = wxr(passwordPost, privatePage, publicPost, passwordDraft, attachment);
	const result = protectContent(source);
	const statuses = readItems(result.xml).map((i) => getField(i.raw, "wp:status"));
	assert.deepEqual(statuses, ["draft", "draft", "publish", "draft", "inherit"]);
	assert.deepEqual(
		result.protected.map((p) => [p.wpId, p.reason, p.originalStatus]),
		[
			[7, "password", "publish"],
			[8, "private", "private"],
			[10, "password", "draft"],
		],
	);
	// Only the two exposing items were rewritten
	const changed = source.length - result.xml.length;
	assert.equal(changed, "publish".length - "draft".length + "private".length - "draft".length);
});

test("an export with nothing protected is returned unchanged", () => {
	const source = wxr(publicPost, attachment);
	assert.equal(protectContent(source).xml, source);
	assert.deepEqual(findProtected(source), []);
});

test("theme unit test data: the one password-protected post is drafted", () => {
	const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");
	const result = protectContent(fixture);
	assert.deepEqual(
		result.protected.map((p) => [p.slug, p.reason, p.originalStatus]),
		[["template-password-protected", "password", "publish"]],
	);
	const after = readItems(result.xml).find((i) => getField(i.raw, "wp:post_name") === "template-password-protected");
	assert.equal(getField(after!.raw, "wp:status"), "draft");
	assert.equal(readItems(result.xml).length, readItems(fixture).length);
});
