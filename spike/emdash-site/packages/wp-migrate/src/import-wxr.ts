/**
 * Drive EmDash's WXR import API the same way the admin UI does (analyze → prepare →
 * execute taxonomy/content/finalize → media → rewrite-urls), saving a report per stage.
 * Moved here from spike/scripts/wp-import.mjs so the tool is self-contained.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface ImportOptions {
	base: string;
	token: string;
	/** The prepared WXR (never the original export) */
	file: string;
	outDir: string;
	media?: boolean;
	log?: (line: string) => void;
}

export interface ImportSummary {
	imported: number;
	skipped: number;
	errors: unknown[];
	byCollection: Record<string, number>;
	media?: { imported: number; failed: number };
	/** Path of the media report the post-import passes read */
	mediaReport?: string;
}

export async function importWxr(options: ImportOptions): Promise<ImportSummary> {
	const { base, token, file, outDir, log = () => {} } = options;
	const api = async (path: string, init: RequestInit = {}) => {
		const response = await fetch(`${base.replace(/\/$/, "")}/_emdash/api${path}`, {
			...init,
			headers: { Authorization: `Bearer ${token}`, "X-EmDash-Request": "1", ...init.headers },
		});
		const body: any = await response.json().catch(() => ({}));
		if (!response.ok || body.success === false) {
			throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 500)}`);
		}
		return body.data ?? body;
	};
	const json = (data: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
	const wxr = new Blob([await readFile(file)], { type: "text/xml" });
	const form = (fields: Record<string, unknown>) => {
		const fd = new FormData();
		fd.append("file", wxr, basename(file));
		for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
		return fd;
	};
	await mkdir(outDir, { recursive: true });
	const save = (name: string, data: unknown) => writeFile(join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);

	const analysis = await api("/import/wordpress/analyze", { method: "POST", body: form({}) });
	await save("1-analysis", analysis);
	log(`analysed: ${analysis.postTypes.map((p: any) => `${p.name}=${p.count}`).join(", ")}, attachments=${analysis.attachments.count}`);

	await save(
		"2-prepare",
		await api(
			"/import/wordpress/prepare",
			json({ postTypes: analysis.postTypes.map((p: any) => ({ name: p.name, collection: p.suggestedCollection, fields: p.requiredFields })) }),
		),
	);

	const config = {
		postTypeMappings: Object.fromEntries(analysis.postTypes.map((p: any) => [p.name, { collection: p.suggestedCollection, enabled: true }])),
		skipExisting: true,
		authorMappings: Object.fromEntries(analysis.authors.map((a: any) => [a.login, null])), // guest bylines
		importMenus: true,
		importSiteTitle: false,
		importLogo: false,
		importSeo: true,
	};
	const summary: ImportSummary = { imported: 0, skipped: 0, errors: [], byCollection: {} };
	const merge = (result: any) => {
		summary.imported += result?.imported ?? 0;
		summary.skipped += result?.skipped ?? 0;
		summary.errors.push(...(result?.errors ?? []));
		for (const [k, v] of Object.entries(result?.byCollection ?? {})) summary.byCollection[k] = (summary.byCollection[k] ?? 0) + (v as number);
	};
	const execute = (phase: string, cursor?: unknown, chunk?: unknown) =>
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
	await save("3-execute", summary);
	log(`imported ${summary.imported}, skipped ${summary.skipped}, errors ${summary.errors.length}`);

	if (options.media !== false && analysis.attachments.count > 0) {
		const media = await api("/import/wordpress/media", json({ attachments: analysis.attachments.items, stream: false }));
		await save("4-media", media);
		summary.media = { imported: media.imported.length, failed: media.failed.length };
		summary.mediaReport = join(outDir, "4-media.json");
		log(`media imported ${media.imported.length}, failed ${media.failed.length}`);
		if (Object.keys(media.urlMap ?? {}).length > 0) await save("5-rewrite-urls", await api("/import/wordpress/rewrite-urls", json({ urlMap: media.urlMap })));
	}
	return summary;
}
