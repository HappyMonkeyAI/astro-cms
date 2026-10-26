#!/usr/bin/env node
/**
 * Drive EmDash's WXR import API the same way the admin UI does
 * (packages/admin/src/lib/api/import.ts @ emdash 1.3.1), saving a report per stage.
 *
 * Usage: node spike/scripts/wp-import.mjs <file.wxr.xml> [--base http://localhost:4321] [--out dir] [--no-media]
 * Auth:  personal access token (admin scope) in spike/emdash-site/.mcp-token or EMDASH_TOKEN.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const wxrPath = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!wxrPath) {
	console.error("Usage: wp-import.mjs <file.wxr.xml> [--base url] [--out dir] [--no-media]");
	process.exit(2);
}

const base = flag("--base", "http://localhost:4321");
const outDir = resolve(flag("--out", join(here, "..", "results", basename(wxrPath, ".xml"))));
const token =
	process.env.EMDASH_TOKEN ??
	(await readFile(join(here, "..", "emdash-site", ".mcp-token"), "utf8").catch(() => "")).trim();
if (!token) {
	console.error("No token: set EMDASH_TOKEN or write one to spike/emdash-site/.mcp-token");
	process.exit(2);
}

const headers = { Authorization: `Bearer ${token}`, "X-EmDash-Request": "1" };
const api = async (path, init = {}) => {
	const response = await fetch(`${base}/_emdash/api${path}`, {
		...init,
		headers: { ...headers, ...init.headers },
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok || body.success === false) {
		throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 500)}`);
	}
	return body.data ?? body;
};
const json = (data) => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(data),
});

await mkdir(outDir, { recursive: true });
const save = (name, data) => writeFile(join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
const timings = {};
const timed = async (label, fn) => {
	const start = performance.now();
	try {
		return await fn();
	} finally {
		timings[label] = Math.round(performance.now() - start);
		console.log(`  ${label}: ${timings[label]} ms`);
	}
};

const wxr = new Blob([await readFile(wxrPath)], { type: "text/xml" });
const form = (fields) => {
	const fd = new FormData();
	fd.append("file", wxr, basename(wxrPath));
	for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
	return fd;
};

console.log(`Importing ${wxrPath} into ${base} (reports: ${outDir})`);
const me = await api("/auth/me");
console.log(`  authenticated as ${me.email} (role ${me.role})`);

// 1. Analyse
const analysis = await timed("analyze", () => api("/import/wordpress/analyze", { method: "POST", body: form({}) }));
await save("1-analysis", analysis);
console.log(
	`  post types: ${analysis.postTypes.map((p) => `${p.name}=${p.count}→${p.suggestedCollection}`).join(", ")}; ` +
		`attachments=${analysis.attachments.count}, categories=${analysis.categories}, tags=${analysis.tags}, ` +
		`authors=${analysis.authors.length}, menus=${analysis.navMenus?.length ?? 0}`,
);

// 2. Prepare collections/fields
const prepared = await timed("prepare", () =>
	api(
		"/import/wordpress/prepare",
		json({
			postTypes: analysis.postTypes.map((p) => ({
				name: p.name,
				collection: p.suggestedCollection,
				fields: p.requiredFields,
			})),
		}),
	),
);
await save("2-prepare", prepared);

// 3. Execute: taxonomy → content chunks → finalize
const config = {
	postTypeMappings: Object.fromEntries(
		analysis.postTypes.map((p) => [p.name, { collection: p.suggestedCollection, enabled: true }]),
	),
	skipExisting: true,
	authorMappings: Object.fromEntries(analysis.authors.map((a) => [a.login, null])), // guest bylines
	importMenus: true,
	importSiteTitle: false,
	importLogo: false,
	importSeo: true,
};
const totals = { imported: 0, skipped: 0, errors: [], byCollection: {}, chunks: [] };
const merge = (result) => {
	totals.imported += result.imported ?? 0;
	totals.skipped += result.skipped ?? 0;
	totals.errors.push(...(result.errors ?? []));
	for (const [k, v] of Object.entries(result.byCollection ?? {})) totals.byCollection[k] = (totals.byCollection[k] ?? 0) + v;
	totals.chunks.push(result);
};
await timed("execute", async () => {
	const execute = (phase, cursor, chunk) =>
		api("/import/wordpress/execute", { method: "POST", body: form({ config, phase, cursor, chunk }) });
	let step = await execute("taxonomy");
	merge(step.result);
	let { cursor, chunk } = step;
	let done = false;
	while (!done) {
		step = await execute("content", cursor, chunk);
		merge(step.result);
		({ cursor, chunk, done } = step);
	}
	merge((await execute("finalize", cursor, chunk)).result);
});
await save("3-execute", totals);
console.log(`  imported=${totals.imported} skipped=${totals.skipped} errors=${totals.errors.length} ${JSON.stringify(totals.byCollection)}`);

// 4. Media + URL rewrite
if (!args.includes("--no-media") && analysis.attachments.count > 0) {
	const media = await timed("media", () =>
		api("/import/wordpress/media", json({ attachments: analysis.attachments.items, stream: false })),
	);
	await save("4-media", media);
	console.log(`  media imported=${media.imported.length} failed=${media.failed.length}`);
	if (Object.keys(media.urlMap ?? {}).length > 0) {
		const rewrite = await timed("rewrite-urls", () =>
			api("/import/wordpress/rewrite-urls", json({ urlMap: media.urlMap })),
		);
		await save("5-rewrite-urls", rewrite);
		console.log(`  urls rewritten=${rewrite.urlsRewritten} in ${rewrite.updated} entries`);
	}
}

await save("timings", timings);
console.log("Done.");
