import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { toMenuName } from "../src/fix-menus.ts";
import { planMenuItems, readMenus, type MenuSpec } from "../src/menus.ts";

test("toMenuName turns WordPress menu slugs into valid EmDash menu names", () => {
	assert.deepEqual(
		["all-pages-flat", "short", "Café Menu", "2024-menu", "επίπεδο", "--"].map(toMenuName),
		["all_pages_flat", "short", "cafe_menu", "menu_2024_menu", "menu_unnamed", "menu_unnamed"],
	);
});

const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");

test("theme unit test data: all 5 menus and 70 items are read, with labels and targets", () => {
	const menus = readMenus(fixture);
	assert.deepEqual(
		menus.map((m) => [m.slug, m.items.length]).sort(),
		[
			["all-pages", 18],
			["all-pages-flat", 18],
			["short", 6],
			["social-menu", 5],
			["testing-menu", 23],
		],
	);
	const items = menus.flatMap((m) => m.items);
	assert.ok(items.every((i) => i.label), "every item has a label (falls back to the target's title)");
	assert.deepEqual(
		Object.entries(items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.target.kind]: (acc[i.target.kind] ?? 0) + 1 }), {})).sort(),
		[
			["custom", 23], // 18 in the testing menu + 5 social links (stored without CDATA)
			["entry", 44],
			["term", 3],
		],
	);
	assert.ok(items.filter((i) => i.target.kind !== "custom").every((i) => (i.target as { slug: string }).slug), "entry and term targets resolve to slugs");
	assert.ok(menus.find((m) => m.slug === "all-pages")!.items.some((i) => i.parentWpId), "nested items keep their parent");
});

const menu: MenuSpec = {
	slug: "main",
	label: "Main",
	items: [
		{ wpId: 1, label: "Home", target: { kind: "custom", url: "https://old.test/" }, order: 1 },
		{ wpId: 2, label: "About", target: { kind: "entry", postType: "page", slug: "about" }, order: 2 },
		{ wpId: 3, label: "Team", target: { kind: "entry", postType: "page", slug: "team" }, order: 3, parentWpId: 2 },
		{ wpId: 4, label: "Secret", target: { kind: "entry", postType: "page", slug: "secret" }, order: 4, parentWpId: 2 },
		{ wpId: 5, label: "Inside secret", target: { kind: "term", taxonomy: "category", slug: "news" }, order: 5, parentWpId: 4 },
		{ wpId: 6, label: "Orphan", target: { kind: "custom", url: "#" }, order: 6, parentWpId: 999, openInNewTab: true },
	],
};

test("planMenuItems resolves targets, keeps nesting, and lifts children of dropped items one level", () => {
	const { items, dropped } = planMenuItems(menu, {
		entry: (_type, slug) => (slug === "secret" ? undefined : { collection: "pages", id: `P-${slug}` }),
		term: (taxonomy, slug) => ({ taxonomy, id: `T-${slug}` }),
		url: (url) => (url === "https://old.test/" ? "/" : url),
	});
	assert.deepEqual(items, [
		{ label: "Home", type: "custom", customUrl: "/" },
		{ label: "About", type: "page", referenceCollection: "pages", referenceId: "P-about" },
		{ label: "Team", type: "page", referenceCollection: "pages", referenceId: "P-team", parentIndex: 1 },
		{ label: "Inside secret", type: "taxonomy", referenceCollection: "category", referenceId: "T-news", parentIndex: 1 },
		{ label: "Orphan", type: "custom", customUrl: "#", target: "_blank" },
	]);
	assert.deepEqual(dropped, [{ label: "Secret", reason: "entry target not published on the new site" }]);
});
