/**
 * `wp-migrate migrate`: the whole migration in order, with one report.
 *
 *   prepare → import (content + media) → shortcodes → media URLs → media metadata →
 *   redirects → menus → baseline revisions → go-live check
 *
 * prepare and import are fatal (nothing after them can work); a failing later pass is
 * recorded and the rest still run, so one report shows everything. The go-live check
 * decides `ready`. Every pass is safe to re-run.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createBaselineRevisions } from "./baseline.ts";
import { goLiveCheck, type GoLiveReport } from "./check.ts";
import { fixMedia } from "./fix-media.ts";
import { fixMenus } from "./fix-menus.ts";
import { fixRedirects } from "./fix-redirects.ts";
import { fixShortcodes } from "./fix-shortcodes.ts";
import { importWxr } from "./import-wxr.ts";
import { uploadLocalMedia } from "./local-media.ts";
import type { ImportedMedia } from "./media.ts";
import { connectMcp } from "./mcp-client.ts";
import { fixMediaMetadata } from "./media-metadata.ts";
import { describePrepared, prepareExport, writePrepared } from "./prepare.ts";
import { connectRest } from "./rest-client.ts";

export interface MigrateOptions {
	exportFile: string;
	outDir: string;
	base: string;
	token: string;
	/** EmDash menu name → WordPress menu slug */
	assign?: Record<string, string>;
	fetchMissing?: boolean;
	/** Local copy of wp-content/uploads, for media the importer couldn't download */
	uploadsDir?: string;
	log?: (line: string) => void;
}

export interface StepResult {
	step: string;
	ok: boolean;
	summary: string;
	ms: number;
}

export interface MigrateReport {
	steps: StepResult[];
	goLive?: GoLiveReport;
	ready: boolean;
}

export async function migrate(options: MigrateOptions): Promise<MigrateReport> {
	const { outDir, base, token, log = () => {} } = options;
	const report: MigrateReport = { steps: [], ready: false };
	const step = async (name: string, fn: () => Promise<{ ok?: boolean; summary: string }>, fatal = false) => {
		const start = performance.now();
		let result: StepResult;
		try {
			const r = await fn();
			result = { step: name, ok: r.ok ?? true, summary: r.summary, ms: Math.round(performance.now() - start) };
		} catch (error) {
			result = { step: name, ok: false, summary: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - start) };
		}
		report.steps.push(result);
		log(`${result.ok ? "✔" : "✖"} ${name}: ${result.summary} (${(result.ms / 1000).toFixed(1)} s)`);
		if (!result.ok && fatal) throw new Error(`${name} failed; stopping`);
		return result;
	};

	try {
		const source = await readFile(options.exportFile, "utf8");
		const prepared = prepareExport(source, basename(options.exportFile));
		let preparedPath = "";
		await step(
			"prepare",
			async () => {
				preparedPath = await writePrepared(outDir, basename(options.exportFile).replace(/\.xml$/i, ""), prepared);
				return { summary: describePrepared(prepared).slice(1).map((l) => l.trim()).filter((l) => !l.startsWith("-") && !l.startsWith("!")).join("; ") };
			},
			true,
		);

		// Content errors stop the run; failed media downloads (e.g. the old host is offline)
		// are reported as their own step so the remaining passes still run.
		let imported: Awaited<ReturnType<typeof importWxr>> | undefined;
		await step(
			"import",
			async () => {
				imported = await importWxr({ base, token, file: preparedPath, outDir: join(outDir, "import") });
				return {
					ok: imported.errors.length === 0,
					summary: `${imported.imported} imported, ${imported.skipped} skipped, ${imported.errors.length} errors`,
				};
			},
			true,
		);
		const mediaReport = imported?.mediaReport;
		if (imported?.media) {
			const { media: m } = imported;
			await step("media import", async () => ({
				// With an uploads folder, the "local media" step decides whether media is complete
				ok: m.failed === 0 || Boolean(options.uploadsDir),
				summary:
					`${m.imported} downloaded, ${m.failed} failed` +
					(m.failed ? (options.uploadsDir ? " (taking them from the uploads folder next)" : " (references to them stay on the old host; use --uploads)") : ""),
			}));
		}

		const media: ImportedMedia[] = mediaReport ? JSON.parse(await readFile(mediaReport, "utf8")).imported ?? [] : [];
		const mcp = await connectMcp(base, token);
		const rest = connectRest(base, token);
		const save = (file: string, data: unknown) => writeFile(join(outDir, file), `${JSON.stringify(data, null, 2)}\n`);

		if (options.uploadsDir) {
			await step("local media", async () => {
				const r = await uploadLocalMedia({ uploadsDir: options.uploadsDir!, attachments: prepared.attachments, imported: media, mcp });
				media.push(...r.uploaded);
				await save("local-media.json", r);
				// Later passes (and re-runs of single commands) read this merged list
				await save("media-merged.json", { imported: media });
				return {
					ok: r.missing.length === 0,
					summary: `${r.uploaded.length} uploaded from ${options.uploadsDir}, ${r.alreadyImported} already imported, ${r.missing.length} missing`,
				};
			});
		}

		await step("shortcodes", async () => {
			const r = await fixShortcodes({ entries: prepared.shortcodes, media, mcp });
			await save("fix-shortcodes.json", r);
			const stuck = r.flatMap((o) => o.stuck).length;
			const failed = r.filter((o) => o.error).length;
			return { ok: !stuck && !failed, summary: `${r.reduce((n, o) => n + o.replaced, 0)} replaced in ${r.length} entries, ${stuck} stuck, ${failed} failed` };
		});
		await step("media URLs", async () => {
			const r = await fixMedia({ legacyHosts: prepared.preflight.legacyHosts, media, mcp, fetchMissing: options.fetchMissing, uploadsDir: options.uploadsDir });
			await save("fix-media.json", r);
			const failed = r.entries.filter((o) => o.error).length;
			const unresolved = new Set(r.entries.flatMap((o) => o.unresolved)).size;
			return { ok: !failed, summary: `${r.entries.reduce((n, o) => n + o.rewritten, 0)} rewritten, ${r.fetched.filter((f) => f.mediaId).length} fetched, ${unresolved} unresolved, ${failed} failed` };
		});
		await step("media metadata", async () => {
			const r = await fixMediaMetadata({ metadata: prepared.mediaMetadata, media, mcp });
			await save("media-metadata-report.json", r);
			return { ok: !r.errors.length, summary: `${r.updated} updated, ${r.missingAlt} without alt text, ${r.errors.length} failed` };
		});
		await step("redirects", async () => {
			const r = await fixRedirects({ permalinks: prepared.permalinks, legacyHosts: prepared.preflight.legacyHosts, mcp, rest });
			await save("redirects.json", r);
			return {
				ok: !r.failed.length && !r.links.some((l) => l.error),
				summary: `${r.created.length} created, ${r.skipped.length} skipped, ${r.failed.length} failed; ${r.links.reduce((n, l) => n + l.rewritten, 0)} internal links rewritten`,
			};
		});
		await step("menus", async () => {
			const r = await fixMenus({ menus: prepared.menus, permalinks: prepared.permalinks, legacyHosts: prepared.preflight.legacyHosts, mcp, assign: options.assign });
			await save("menus-report.json", r);
			const failed = r.filter((o) => o.error).length;
			return { ok: !failed, summary: `${r.length - failed} menus written, ${r.reduce((n, o) => n + o.dropped.length, 0)} items dropped, ${failed} failed` };
		});
		await step("baseline revisions", async () => {
			const r = await createBaselineRevisions({ mcp });
			await save("baseline.json", r);
			return {
				ok: !r.failed.length,
				summary:
					`${r.created.length} created, ${r.blocked.length} saved but re-publish blocked by migration-guard, ` +
					`${r.alreadyHadHistory} already had history, ${r.failed.length} failed`,
			};
		});
		await step("go-live check", async () => {
			report.goLive = await goLiveCheck({ rest, mcp, legacyHosts: prepared.preflight.legacyHosts });
			await save("go-live.json", report.goLive);
			return {
				ok: report.goLive.ready,
				summary: report.goLive.ready
					? `ready: ${report.goLive.scanned} entries scanned, 0 issues${report.goLive.pendingDrafts.length ? `, ${report.goLive.pendingDrafts.length} with unpublished changes to review` : ""}`
					: `NOT ready: ${report.goLive.issues.length} issue(s), e.g. ${report.goLive.issues.slice(0, 3).map((i) => `${i.collection}/${i.slug}: ${i.problem}`).join("; ")}`,
			};
		});
	} catch (error) {
		log(error instanceof Error ? error.message : String(error));
	}
	report.ready = Boolean(report.goLive?.ready) && report.steps.every((s) => s.ok);
	await writeFile(join(outDir, "migrate-report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
	return report;
}
