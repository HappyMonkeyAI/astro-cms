import assert from "node:assert/strict";
import { test } from "node:test";

import { findMenu } from "../src/fix-menus.ts";
import { describePrepared, prepareExport } from "../src/prepare.ts";
import { isPrivateHost, parseProductionUrl, rehostExport, rewriteSerialized } from "../src/rehost.ts";

const staging = `<?xml version="1.0" encoding="UTF-8" ?>
<rss><channel>
<link>http://localhost:8080</link>
<wp:base_blog_url>http://localhost:8080</wp:base_blog_url>
<item>
<title>About</title>
<link>http://localhost:8080/about/</link>
<content:encoded><![CDATA[<a href="http://localhost:8080/contact/">Contact</a> <img src="//localhost:8080/wp-content/uploads/a.jpg"> <a href="http://localhost:80801/">other</a> <a href="http://localhost:9000/x">other port</a>]]></content:encoded>
<wp:post_id>1</wp:post_id>
<wp:post_name>about</wp:post_name>
<wp:post_type>page</wp:post_type>
<wp:status>publish</wp:status>
<wp:postmeta><wp:meta_key>_elementor_data</wp:meta_key><wp:meta_value><![CDATA[[{"url":"http:\/\/localhost:8080\/wp-content\/uploads\/b.png"}]]]></wp:meta_value></wp:postmeta>
<wp:postmeta><wp:meta_key>_links</wp:meta_key><wp:meta_value><![CDATA[a:2:{s:3:"url";s:31:"http://localhost:8080/café.jpg";s:4:"note";s:2:"hi";}]]></wp:meta_value></wp:postmeta>
</item>
<item>
<title>a.jpg</title>
<wp:post_id>2</wp:post_id>
<wp:post_type>attachment</wp:post_type>
<wp:attachment_url>http://localhost:8080/wp-content/uploads/a.jpg</wp:attachment_url>
</item>
</channel></rss>`;

test("isPrivateHost: loopback, private ranges and local-only names", () => {
	for (const h of ["localhost", "site.localhost", "client.local", "wp.test", "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.10", "[::1]", "wordpress"]) assert.ok(isPrivateHost(h), h);
	for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "client.co.uk"]) assert.ok(!isPrivateHost(h), h);
});

test("parseProductionUrl wants the live site's public URL", () => {
	assert.equal(parseProductionUrl("https://client.example/"), "https://client.example");
	assert.equal(parseProductionUrl("https://client.example/blog/"), "https://client.example/blog");
	assert.throws(() => parseProductionUrl("client.example"), /full URL/);
	assert.throws(() => parseProductionUrl("http://localhost:8080"), /public URL/);
});

test("rewriteSerialized fixes byte lengths and rejects invalid data", () => {
	const out = rewriteSerialized('a:1:{s:1:"u";s:5:"short";}', (s) => s.replace("short", "much longer é"));
	assert.equal(out, 'a:1:{s:1:"u";s:14:"much longer é";}');
	assert.equal(rewriteSerialized('a:1:{s:9:"u";}', (s) => s), undefined);
});

test("rehostExport puts the live URL back in every form", () => {
	const { xml, rehosted } = rehostExport(staging, "https://client.example");
	assert.equal(rehosted.from, "http://localhost:8080");
	assert.ok(xml.includes("<wp:base_blog_url>https://client.example</wp:base_blog_url>"));
	assert.ok(xml.includes('href="https://client.example/contact/"'));
	assert.ok(xml.includes('src="https://client.example/wp-content/uploads/a.jpg"'), "protocol-relative");
	assert.ok(xml.includes('"url":"https:\/\/client.example\/wp-content\/uploads\/b.png"'), "JSON-escaped");
	assert.ok(xml.includes('s:32:"https://client.example/café.jpg";s:4:"note";s:2:"hi";'), "serialized length fixed");
	assert.ok(xml.includes("http://localhost:80801/") && xml.includes("http://localhost:9000/x"), "other hosts and ports untouched");
	assert.equal(rehosted.replacements, 8);
});

test("preflight warns about a localhost export, and --production-url clears the warning", () => {
	const before = describePrepared(prepareExport(staging, "staging.xml")).join("\n");
	assert.match(before, /local or private legacy host: localhost/);
	assert.match(before, /--production-url/);

	const prepared = prepareExport(staging, "staging.xml", { productionUrl: "https://client.example" });
	const after = describePrepared(prepared).join("\n");
	assert.doesNotMatch(after, /local or private legacy host/);
	assert.match(after, /rewrote 8 URL\(s\) from http:\/\/localhost:8080 to https:\/\/client.example/);
	// Leftovers on the old host (another port) are still caught by the go-live check
	assert.deepEqual(prepared.preflight.legacyHosts, ["client.example", "localhost"]);
	assert.equal(prepared.attachments[0].url, "https://client.example/wp-content/uploads/a.jpg");
});

test("findMenu matches --assign by slug, EmDash name or label", () => {
	const menus = [{ slug: "main-menu", label: "Main Menu", items: [] }, { slug: "footer", label: "Footer Links", items: [] }];
	for (const ref of ["main-menu", "main_menu", "Main Menu", "MAIN-MENU"]) assert.equal(findMenu(menus, ref)?.slug, "main-menu", ref);
	assert.equal(findMenu(menus, "footer links")?.slug, "footer");
	assert.equal(findMenu(menus, "header"), undefined);
});
