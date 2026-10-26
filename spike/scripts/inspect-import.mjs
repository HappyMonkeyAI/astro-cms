#!/usr/bin/env node
/**
 * Compare a WXR source file with what EmDash stored after import.
 * Reads Postgres via `docker compose exec db psql` (spike stack), writes a JSON report and prints a summary.
 *
 * Usage: node spike/scripts/inspect-import.mjs <file.wxr.xml> [--out report.json]
 */

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = join(here, "..", "emdash-site");
const [wxrPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > -1 ? process.argv[outIndex + 1] : join(here, "..", "results", "inspect-report.json");

// ---------------------------------------------------------------- source (WXR)
const xml = await readFile(wxrPath, "utf8");
const cdata = (s) => s?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "") ?? "";
const tag = (item, name) => cdata(item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim());
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
const source = items
	.map((item) => ({
		wpId: Number(tag(item, "wp:post_id")),
		type: tag(item, "wp:post_type"),
		status: tag(item, "wp:status"),
		slug: tag(item, "wp:post_name"),
		title: tag(item, "title"),
		parent: Number(tag(item, "wp:post_parent")),
		password: tag(item, "wp:post_password"),
		sticky: tag(item, "wp:is_sticky") === "1",
		date: tag(item, "wp:post_date"),
		content: tag(item, "content:encoded"),
		comments: (item.match(/<wp:comment>/g) ?? []).length,
	}))
	.filter((i) => i.type === "post" || i.type === "page");

// ---------------------------------------------------------------- stored (Postgres)
const sql = (query) =>
	execFileSync("docker", ["compose", "exec", "-T", "db", "psql", "-U", "emdash", "-At", "-c", query], {
		cwd: siteDir,
		encoding: "utf8",
		env: { ...process.env, MSYS_NO_PATHCONV: "1" },
	}).trim();
const rows = (query) => JSON.parse(sql(`select coalesce(json_agg(t), '[]') from (${query}) t`));

const entries = ["posts", "pages"].flatMap((collection) =>
	rows(
		`select '${collection}' as collection, id, slug, status, title, published_at, scheduled_at, content, excerpt, primary_byline_id ${collection === "posts" ? ", featured_image" : ""} from ec_${collection} where deleted_at is null`,
	),
);
const count = (q) => Number(sql(q));

// ---------------------------------------------------------------- checks
const ptText = (blocks) =>
	(blocks ?? [])
		.map((b) => (b.children ?? []).map((c) => c.text ?? "").join("") + (b.html ?? b.code ?? ""))
		.join("\n");
const blockTypes = {};
const shortcodesLeft = {};
const leftoverExamples = [];
let externalUrlRefs = 0;
const externalUrlEntries = new Set();
const emptyHtmlBlocks = [];

for (const entry of entries) {
	const blocks = entry.content ?? [];
	for (const b of blocks) blockTypes[b._type] = (blockTypes[b._type] ?? 0) + 1;
	const text = ptText(blocks);
	for (const m of text.matchAll(/\[\/?([a-z_]+)[^\]]*\]/g)) {
		shortcodesLeft[m[1]] = (shortcodesLeft[m[1]] ?? 0) + 1;
		if (leftoverExamples.length < 8) leftoverExamples.push({ slug: entry.slug, shortcode: m[0].slice(0, 90) });
	}
	const raw = JSON.stringify(blocks);
	const ext = raw.match(/https?:\/\/wpthemetestdata\.(?:files\.)?wordpress\.com[^"\s)]*/g) ?? [];
	externalUrlRefs += ext.length;
	if (ext.length) externalUrlEntries.add(entry.slug);
	for (const b of blocks) if (b._type === "htmlBlock" && !String(b.html ?? "").trim()) emptyHtmlBlocks.push(entry.slug);
}

const bySlug = new Map(entries.map((e) => [`${e.collection === "posts" ? "post" : "page"}:${e.slug}`, e]));
const statusMap = {};
const missing = [];
const slugChanged = [];
for (const s of source) {
	const e = bySlug.get(`${s.type}:${s.slug}`) ?? entries.find((x) => x.title === s.title && x.collection.startsWith(s.type));
	if (!e) {
		missing.push({ type: s.type, slug: s.slug, title: s.title, status: s.status });
		continue;
	}
	if (e.slug !== s.slug) slugChanged.push({ from: s.slug, to: e.slug });
	const key = `${s.status} → ${e.status}${e.scheduled_at ? " (scheduled)" : ""}`;
	statusMap[key] = (statusMap[key] ?? 0) + 1;
	s.match = e;
}

const sourceText = (s) => s.content;
const report = {
	source: {
		posts: source.filter((s) => s.type === "post").length,
		pages: source.filter((s) => s.type === "page").length,
		byStatus: source.reduce((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {}),
		shortcodes: [...new Set(source.flatMap((s) => [...sourceText(s).matchAll(/\[([a-z_]+)[\s\]]/g)].map((m) => m[1])))],
		passwordProtected: source.filter((s) => s.password).map((s) => s.slug),
		sticky: source.filter((s) => s.sticky).map((s) => s.slug),
		childPages: source.filter((s) => s.type === "page" && s.parent).length,
		moreTags: source.filter((s) => s.content.includes("<!--more")).length,
		nextpageTags: source.filter((s) => s.content.includes("<!--nextpage-->")).length,
		comments: source.reduce((a, s) => a + s.comments, 0),
	},
	stored: {
		posts: entries.filter((e) => e.collection === "posts").length,
		pages: entries.filter((e) => e.collection === "pages").length,
		statusMapping: statusMap,
		missing,
		slugChanged,
		blockTypes,
		shortcodesLeftAsText: shortcodesLeft,
		leftoverExamples,
		externalMediaUrlRefs: externalUrlRefs,
		entriesStillReferencingOldHost: externalUrlEntries.size,
		emptyHtmlBlocks,
		moreTagsInContent: entries.filter((e) => JSON.stringify(e.content).includes("<!--more")).length,
		nextpageTagsInContent: entries.filter((e) => JSON.stringify(e.content).includes("<!--nextpage")).length,
		featuredImages: entries.filter((e) => e.featured_image).length,
		media: count("select count(*) from media"),
		bylines: rows("select display_name, count(*)::int as n from _emdash_bylines group by display_name order by 2 desc"),
		entriesWithByline: entries.filter((e) => e.primary_byline_id).length,
		taxonomyTerms: rows("select name as taxonomy, count(*)::int as terms from taxonomies group by name"),
		termAssignments: count("select count(*) from content_taxonomies"),
		menus: count("select count(*) from _emdash_menus"),
		menuItems: count("select count(*) from _emdash_menu_items"),
		redirects: count("select count(*) from _emdash_redirects"),
		comments: count("select count(*) from _emdash_comments"),
		revisions: count("select count(*) from revisions"),
	},
};

await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, (k, v) => (k === "missing" && v.length > 10 ? [...v.slice(0, 10), `…${v.length - 10} more`] : v), 2));
console.error(`\nReport written to ${outPath}`);
