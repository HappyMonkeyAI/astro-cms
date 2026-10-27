import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { legacyUrlPattern } from "../src/legacy-hosts.ts";
import { readPermalinks, type Permalink } from "../src/permalinks.ts";
import { planRedirects, rewriteLinks } from "../src/redirects.ts";
import { decodeSlugs } from "../src/slugs.ts";

const permalink = (wpId: number, postType: string, slug: string, link: string, status = "publish"): Permalink => ({
	wpId,
	postType,
	slug,
	status,
	link,
	path: new URL(link).search ? undefined : new URL(link).pathname,
});

const base = {
	collections: { post: "posts", page: "pages" },
	urlPatterns: { posts: "/posts/{slug}", pages: "/pages/{slug}" },
	published: { posts: new Set(["hello", "same"]), pages: new Set(["child"]) },
	existingSources: new Set(["/already/"]),
};

test("planRedirects maps old permalinks to new URLs and explains every skip", () => {
	const plan = planRedirects({
		...base,
		permalinks: [
			permalink(1, "post", "hello", "https://old.test/2008/09/03/hello/"),
			permalink(2, "page", "child", "https://old.test/parent/child/"),
			permalink(3, "post", "draft-one", "https://old.test/2020/01/01/draft-one/", "draft"),
			permalink(4, "post", "", "https://old.test/?p=4"),
			permalink(5, "post", "same", "https://old.test/posts/same/"),
			permalink(6, "post", "hello", "https://old.test/already/"),
			permalink(7, "product", "mug", "https://old.test/shop/mug/"),
		],
	});
	assert.deepEqual(
		plan.create.map((r) => [r.source, r.destination]),
		[
			["/2008/09/03/hello/", "/posts/hello"],
			["/parent/child/", "/pages/child"],
		],
	);
	assert.deepEqual(
		plan.skipped.map((s) => [s.wpId, s.reason]),
		[
			[3, "not published on the new site"],
			[4, "plain permalink (?p=) can't be redirected by path"],
			[5, "URL unchanged"],
			[6, "redirect already exists"],
			[7, "collection products has no URL pattern"],
		],
	);
	assert.equal(plan.map.get("/parent/child"), "/pages/child");
});

test("rewriteLinks points internal links at new URLs, keeps fragments, reports the rest", () => {
	const map = new Map([["/2008/09/03/hello", "/posts/hello"]]);
	const content = [
		{
			_type: "block",
			markDefs: [
				{ _key: "a", _type: "link", href: "https://old.test/2008/09/03/hello/#comments" },
				{ _key: "b", _type: "link", href: "https://old.test/" },
				{ _key: "c", _type: "link", href: "https://old.test/category/news/" },
				{ _key: "d", _type: "link", href: "https://elsewhere.test/2008/09/03/hello/" },
			],
		},
	];
	const result = rewriteLinks(content, legacyUrlPattern(["old.test"]), map);
	assert.deepEqual(
		result.value[0].markDefs.map((d) => d.href),
		["/posts/hello#comments", "/", "https://old.test/category/news/", "https://elsewhere.test/2008/09/03/hello/"],
	);
	assert.equal(result.rewritten, 2);
	assert.deepEqual(result.unresolved, ["https://old.test/category/news/"]);
});

test("decodeSlugs decodes encoded post and term slugs in elements and attributes, leaving ASCII alone", () => {
	const xml = [
		"<wp:post_name><![CDATA[%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2]]></wp:post_name>",
		"<wp:post_name>plain-slug</wp:post_name>",
		"<wp:category_nicename>caf%c3%a9</wp:category_nicename>",
		`<category domain="category" nicename="caf%c3%a9"><![CDATA[Café]]></category>`,
		"<wp:post_name>bad-%zz</wp:post_name>",
	].join("\n");
	const { xml: out, decoded } = decodeSlugs(xml);
	assert.equal(
		out,
		[
			"<wp:post_name><![CDATA[επίπεδο-2]]></wp:post_name>",
			"<wp:post_name>plain-slug</wp:post_name>",
			"<wp:category_nicename>café</wp:category_nicename>",
			`<category domain="category" nicename="café"><![CDATA[Café]]></category>`,
			"<wp:post_name>bad-%zz</wp:post_name>",
		].join("\n"),
	);
	assert.equal(decoded.length, 3);
});

test("non-ASCII and double-slash permalinks redirect with browser-style encoding", () => {
	const permalinks = readPermalinks(
		`<rss><channel><item><title>x</title><link>https://old.test//greek/%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2/</link><wp:post_id>9</wp:post_id><wp:post_name>%ce%b5%cf%80%ce%af%cf%80%ce%b5%ce%b4%ce%bf-2</wp:post_name><wp:status>publish</wp:status><wp:post_type>page</wp:post_type></item></channel></rss>`,
	);
	assert.equal(permalinks[0].path, "/greek/επίπεδο-2/");
	const plan = planRedirects({ ...base, published: { posts: new Set(), pages: new Set(["επίπεδο-2"]) }, permalinks });
	assert.deepEqual(
		plan.create.map((r) => [r.source, r.destination]),
		[["/greek/%CE%B5%CF%80%CE%AF%CF%80%CE%B5%CE%B4%CE%BF-2/", "/pages/%CE%B5%CF%80%CE%AF%CF%80%CE%B5%CE%B4%CE%BF-2"]],
	);
});

test("theme unit test data: permalinks keep nested page paths", () => {
	const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");
	const permalinks = readPermalinks(fixture);
	assert.equal(permalinks.length, 79);
	const nested = permalinks.filter((p) => p.postType === "page" && (p.path?.split("/").filter(Boolean).length ?? 0) > 1);
	assert.ok(nested.length >= 10, `expected nested page paths, got ${nested.length}`);
	assert.ok(permalinks.some((p) => p.path === "/2008/09/03/template-sticky/" || p.path?.endsWith("/template-sticky/")));
});
