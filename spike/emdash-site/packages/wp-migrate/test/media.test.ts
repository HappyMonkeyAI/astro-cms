import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { findLegacyHosts, legacyUrlPattern } from "../src/legacy-hosts.ts";
import { createMediaResolver } from "../src/media.ts";
import { rewriteMediaRefs } from "../src/rewrite-media.ts";

const resolve = createMediaResolver([
	{ wpId: 755, originalUrl: "https://old.files.test/2013/03/a.jpg", newUrl: "/m/a.jpg", mediaId: "MA" },
	{ wpId: 12, originalUrl: "https://old.files.test/2018/11/doc.pdf", newUrl: "/m/doc.pdf", mediaId: "MD" },
]);
const options = { legacyUrl: legacyUrlPattern(["old.files.test", "old.test"]), resolve };

test("legacy hosts come from the site URLs and every attachment URL", () => {
	const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");
	assert.deepEqual(findLegacyHosts(fixture), ["wpthemetestdata.files.wordpress.com", "wpthemetestdata.wordpress.com"]);
});

test("legacyUrlPattern matches absolute and protocol-relative URLs, not look-alike hosts", () => {
	const text = `a https://old.test/x b //old.files.test/y.jpg c https://old.test.evil.com/z d https://notold.test/w`;
	assert.deepEqual(text.match(legacyUrlPattern(["old.test", "old.files.test"])), ["https://old.test/x", "//old.files.test/y.jpg"]);
});

test("asset references move to the media library: legacy URL, size variant, or WP attachment ID", () => {
	const content = [
		{ _type: "image", _key: "1", asset: { _type: "reference", _ref: "https://old.files.test/2013/03/a-150x150.jpg", url: "https://old.files.test/2013/03/a-150x150.jpg" } },
		{ _type: "gallery", _key: "2", images: [{ _type: "image", _key: "3", asset: { _type: "reference", _ref: "755", url: "https://old.files.test/2013/03/a.jpg?w=300" } }] },
		{ _type: "columns", _key: "4", columns: [{ content: [{ _type: "image", _key: "5", asset: { _type: "reference", _ref: "MA", url: "/m/a.jpg" } }] }] },
	];
	const result = rewriteMediaRefs(content, options);
	assert.deepEqual(result.value[0].asset, { _type: "reference", _ref: "MA", url: "/m/a.jpg" });
	assert.deepEqual((result.value[1] as any).images[0].asset, { _type: "reference", _ref: "MA", url: "/m/a.jpg" });
	assert.deepEqual(result.value[2], content[2], "already-local references are untouched");
	assert.equal(result.rewritten, 2);
	assert.deepEqual(result.unresolved, []);
});

test("legacy media URLs inside any string are rewritten; unknown ones are reported and kept", () => {
	const content = [
		{ _type: "cover", _key: "1", backgroundImage: "https://old.files.test/2013/03/a-1024x768.jpg" },
		{ _type: "file", _key: "2", url: "https://old.files.test/2018/11/doc.pdf" },
		{ _type: "embed", _key: "3", html: `<figure><img src="https://old.files.test/2013/03/a.jpg" /></figure>` },
		{ _type: "block", _key: "4", markDefs: [{ _key: "l", _type: "link", href: "https://old.test/2008/09/03/hello/" }], children: [] },
	];
	const result = rewriteMediaRefs(content, options);
	assert.equal((result.value[0] as any).backgroundImage, "/m/a.jpg");
	assert.equal((result.value[1] as any).url, "/m/doc.pdf");
	assert.equal((result.value[2] as any).html, `<figure><img src="/m/a.jpg" /></figure>`);
	assert.equal((result.value[3] as any).markDefs[0].href, "https://old.test/2008/09/03/hello/", "page links are for the redirects pass");
	assert.equal(result.rewritten, 3);
	assert.deepEqual(result.unresolved, ["https://old.test/2008/09/03/hello/"]);
});

test("values without legacy URLs come back unchanged", () => {
	const content = { title: "Hello", body: [{ _type: "block", _key: "b", children: [{ _type: "span", _key: "s", text: "https://elsewhere.test/a.jpg" }] }] };
	const result = rewriteMediaRefs(content, options);
	assert.deepEqual(result.value, content);
	assert.equal(result.rewritten, 0);
});
