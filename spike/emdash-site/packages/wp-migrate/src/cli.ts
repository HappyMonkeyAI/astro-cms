#!/usr/bin/env node
/**
 * wp-migrate: WordPress → EmDash migration around EmDash's own importer.
 *
 *   wp-migrate migrate <export.xml> --out <dir> --base <site-url> [--assign primary=<wp-menu-slug>]...
 *                      [--uploads <copy of wp-content/uploads>] [--fetch-missing] [--production-url <live site URL>]
 *                                                      everything below in order, then the go-live check; exit 0 = ready.
 *                                                      --uploads supplies media the old host can't serve (offline, LAN, local)
 *                                                      --production-url replaces the export's site URL (e.g. localhost after a
 *                                                      staging search-replace) with the live one before anything else
 *   wp-migrate check --prepared <dir> --base <site-url>
 *                                                      go-live check: migration-guard scan + leftover markers = 0
 *
 *   The individual steps:
 *   wp-migrate preflight <export.xml> [--production-url <url>]   report what needs attention; changes nothing
 *   wp-migrate prepare   <export.xml> --out <dir> [--production-url <url>]
 *                                                      write <dir>/<name>.prepared.xml to import, plus
 *                                                      preflight.json and shortcodes.json
 *   (import the prepared file with EmDash, including media)
 *   wp-migrate forms --prepared <dir> --base <site-url> [--dry-run]
 *                                                      create the export's forms with the forms plugin
 *                                                      (@emdash-cms/plugin-forms); run before fix-shortcodes
 *   wp-migrate fix-shortcodes --prepared <dir> --media <media-report.json> --base <site-url> [--dry-run]
 *                                                      replace shortcode markers with real blocks over MCP
 *                                                      (form blocks use the IDs in forms-report.json)
 *                                                      (token: EMDASH_TOKEN, admin scope)
 *   wp-migrate fix-media --prepared <dir> --media <media-report.json> --base <site-url> [--fetch-missing] [--dry-run]
 *                                                      point every legacy media URL/reference at the media library;
 *                                                      --fetch-missing also downloads linked files the export didn't attach
 *   wp-migrate redirects --prepared <dir> --base <site-url> [--dry-run]
 *                                                      301s from old permalinks to new URLs (EmDash core redirects,
 *                                                      group "wp-migrate"); rewrite internal links to old pages
 *   wp-migrate menus --prepared <dir> --base <site-url> [--assign primary=<wp-menu-slug>]... [--dry-run]
 *                                                      one EmDash menu per WordPress menu; --assign fills a site menu
 *                                                      (theme locations aren't in the export)
 *   wp-migrate media-metadata --prepared <dir> --media <media-report.json> --base <site-url> [--dry-run]
 *                                                      restore alt text and captions (fills empty fields only)
 *   wp-migrate baseline --base <site-url> [--prepared <dir>] [--dry-run]
 *                                                      run last: give every entry without history a revision of its
 *                                                      migrated state, so the first edit can be undone
 *
 * Import the prepared file, never the original.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createBaselineRevisions } from "./baseline.ts";
import { goLiveCheck } from "./check.ts";
import { readImportCollections } from "./collections.ts";
import { fixForms } from "./fix-forms.ts";
import { fixMedia } from "./fix-media.ts";
import { fixMenus } from "./fix-menus.ts";
import { fixRedirects } from "./fix-redirects.ts";
import { fixShortcodes } from "./fix-shortcodes.ts";
import { connectMcp } from "./mcp-client.ts";
import { fixMediaMetadata } from "./media-metadata.ts";
import { uploadLocalMedia } from "./local-media.ts";
import { migrate } from "./pipeline.ts";
import { describePrepared, prepareExport, writePrepared } from "./prepare.ts";
import { parseProductionUrl } from "./rehost.ts";
import { connectRest } from "./rest-client.ts";
import type { ShortcodeEntry } from "./shortcodes.ts";

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};
const positional = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

/** Repeatable `--assign <emdash-menu>=<wp-menu-slug>` */
function readAssign(): Record<string, string> {
	const assign: Record<string, string> = {};
	args.forEach((a, i) => {
		if (a !== "--assign") return;
		const [name, from] = (args[i + 1] ?? "").split("=");
		if (!name || !from) usage();
		assign[name] = from;
	});
	return assign;
}

function usage(): never {
	console.error(
		[
			"Usage: wp-migrate migrate <export.xml> --out <dir> --base <site-url> [--assign primary=<wp-menu-slug>]... [--uploads <wp-content/uploads copy>] [--fetch-missing] [--production-url <url>]",
			"       wp-migrate local-media --prepared <dir> --media <media-report.json> --uploads <dir> --base <site-url> [--dry-run]",
			"       wp-migrate preflight <export.xml> [--production-url <url>]",
			"       wp-migrate prepare <export.xml> --out <dir> [--production-url <url>]",
			"       wp-migrate check --prepared <dir> --base <site-url>",
			"       wp-migrate forms --prepared <dir> --base <site-url> [--dry-run]",
			"       wp-migrate fix-shortcodes --prepared <dir> --media <media-report.json> --base <site-url> [--dry-run]",
			"       wp-migrate fix-media --prepared <dir> --media <media-report.json> --base <site-url> [--fetch-missing] [--dry-run]",
			"       wp-migrate redirects --prepared <dir> --base <site-url> [--dry-run]",
			"       wp-migrate menus --prepared <dir> --base <site-url> [--assign <emdash-menu>=<wp-menu-slug>]... [--dry-run]",
			"       wp-migrate media-metadata --prepared <dir> --media <media-report.json> --base <site-url> [--dry-run]",
			"       wp-migrate baseline --base <site-url> [--prepared <dir>] [--dry-run]",
		].join("\n"),
	);
	process.exit(2);
}

if (option("--production-url") !== undefined) {
	try {
		parseProductionUrl(option("--production-url") ?? "");
	} catch (error) {
		console.error((error as Error).message);
		process.exit(2);
	}
}

if (command === "preflight" || command === "prepare") {
	if (!positional) usage();
	const prepared = prepareExport(await readFile(positional, "utf8"), basename(positional), { productionUrl: option("--production-url") });
	console.log(describePrepared(prepared).join("\n"));
	if (command === "prepare") {
		const outDir = option("--out");
		if (!outDir) usage();
		const preparedPath = await writePrepared(outDir, basename(positional).replace(/\.xml$/i, ""), prepared);
		console.log(`Wrote ${preparedPath} and the pass inputs. Import the prepared file, not the original.`);
	}
} else if (command === "migrate") {
	const outDir = option("--out");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!positional || !outDir || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const report = await migrate({
		exportFile: positional,
		outDir,
		base,
		token,
		assign: readAssign(),
		fetchMissing: args.includes("--fetch-missing"),
		uploadsDir: option("--uploads"),
		productionUrl: option("--production-url"),
		log: (line) => console.log(line),
	});
	console.log(report.ready ? "\nREADY TO GO LIVE" : `\nNOT READY: see ${join(outDir, "migrate-report.json")} and go-live.json`);
	process.exitCode = report.ready ? 0 : 1;
} else if (command === "check") {
	const prepared = option("--prepared");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!prepared || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const { legacyHosts } = JSON.parse(await readFile(join(prepared, "preflight.json"), "utf8"));
	const report = await goLiveCheck({ rest: connectRest(base, token), mcp: await connectMcp(base, token), legacyHosts });
	await writeFile(join(prepared, "go-live.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(report.ready ? `READY TO GO LIVE: ${report.scanned} entries scanned, 0 issues` : `NOT READY: ${report.issues.length} issue(s)`);
	for (const issue of report.issues.slice(0, 20)) console.log(`  - ${issue.collection}/${issue.slug}: ${issue.problem}`);
	if (report.pendingDrafts.length) {
		console.log(`${report.pendingDrafts.length} published entr${report.pendingDrafts.length === 1 ? "y has" : "ies have"} unpublished changes to review (not scanned; migration-guard blocks publishing leftovers):`);
		for (const d of report.pendingDrafts.slice(0, 20)) console.log(`  - ${d.collection}/${d.slug}`);
	}
	process.exitCode = report.ready ? 0 : 1;
} else if (command === "media-metadata" || command === "baseline") {
	const prepared = option("--prepared");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!base || (command === "media-metadata" && (!prepared || !option("--media")))) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const mcp = await connectMcp(base, token);
	const dryRun = args.includes("--dry-run");
	const log = (line: string) => console.log(`  ${line}`);
	if (command === "media-metadata") {
		const report = await fixMediaMetadata({
			metadata: JSON.parse(await readFile(join(prepared!, "media-metadata.json"), "utf8")),
			media: JSON.parse(await readFile(option("--media")!, "utf8")).imported ?? [],
			mcp,
			dryRun,
		});
		await writeFile(join(prepared!, "media-metadata-report.json"), `${JSON.stringify(report, null, 2)}\n`);
		console.log(
			`Media metadata: ${report.updated} updated, ${report.skippedAlreadySet} already set, ${report.noMetadata} without metadata, ` +
				`${report.missingAlt} still without alt text, ${report.errors.length} failed`,
		);
		if (report.errors.length) process.exitCode = 1;
	} else {
		const report = await createBaselineRevisions({ mcp, dryRun, log });
		if (prepared) await writeFile(join(prepared, "baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
		for (const f of report.failed.slice(0, 10)) console.log(`  ! ${f.collection}/${f.slug}: ${f.error}`);
		if (report.failed.length) process.exitCode = 1;
	}
} else if (command === "menus") {
	const prepared = option("--prepared");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!prepared || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const assign = readAssign();
	const read = async (file: string) => JSON.parse(await readFile(join(prepared, file), "utf8"));
	const outcomes = await fixMenus({
		menus: await read("menus.json"),
		permalinks: await read("permalinks.json"),
		legacyHosts: (await read("preflight.json")).legacyHosts,
		mcp: await connectMcp(base, token),
		assign,
		collections: await readImportCollections(prepared),
		dryRun: args.includes("--dry-run"),
		log: (line) => console.log(`  ${line}`),
	});
	await writeFile(join(prepared, "menus-report.json"), `${JSON.stringify(outcomes, null, 2)}\n`);
	const failed = outcomes.filter((o) => o.error);
	console.log(`Menus: ${outcomes.length - failed.length} written (${outcomes.reduce((n, o) => n + o.items, 0)} items, ${outcomes.reduce((n, o) => n + o.dropped.length, 0)} dropped), ${failed.length} failed`);
	for (const f of failed) console.log(`  ! ${f.menu}: ${f.error}`);
	if (failed.length) process.exitCode = 1;
} else if (command === "forms") {
	const prepared = option("--prepared");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!prepared || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const report = await fixForms({
		forms: JSON.parse(await readFile(join(prepared, "forms.json"), "utf8")),
		rest: connectRest(base, token),
		dryRun: args.includes("--dry-run"),
		log: (line) => console.log(`  ${line}`),
	});
	await writeFile(join(prepared, "forms-report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Forms: ${report.created.length} created, ${report.existing.length} already there, ${report.failed.length} failed`);
	for (const r of report.toReview) for (const note of r.notes) console.log(`  ! ${r.slug}: ${note}`);
	if (report.failed.length) process.exitCode = 1;
} else if (command === "redirects") {
	const prepared = option("--prepared");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!prepared || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const { legacyHosts } = JSON.parse(await readFile(join(prepared, "preflight.json"), "utf8"));
	const permalinks = JSON.parse(await readFile(join(prepared, "permalinks.json"), "utf8"));
	const report = await fixRedirects({
		permalinks,
		legacyHosts,
		mcp: await connectMcp(base, token),
		rest: connectRest(base, token),
		collections: await readImportCollections(prepared),
		dryRun: args.includes("--dry-run"),
		log: (line) => console.log(`  ${line}`),
	});
	await writeFile(join(prepared, "redirects.json"), `${JSON.stringify(report, null, 2)}\n`);
	const reasons = report.skipped.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {});
	const links = report.links.reduce((n, l) => n + l.rewritten, 0);
	const unresolved = [...new Set(report.links.flatMap((l) => l.unresolved))];
	console.log(`Created ${report.created.length} redirect(s), ${report.failed.length} failed; skipped: ${JSON.stringify(reasons)}`);
	console.log(`Rewrote ${links} internal link(s); ${unresolved.length} legacy URL(s) left unchanged`);
	for (const f of report.failed.slice(0, 10)) console.log(`  ! ${f.source}: ${f.error}`);
	for (const url of unresolved.slice(0, 10)) console.log(`  - ${url}`);
	if (report.failed.length || report.links.some((l) => l.error)) process.exitCode = 1;
} else if (command === "fix-shortcodes" || command === "fix-media" || command === "local-media") {
	const prepared = option("--prepared");
	const mediaPath = option("--media");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!prepared || !mediaPath || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const media = JSON.parse(await readFile(mediaPath, "utf8")).imported ?? [];
	const mcp = await connectMcp(base, token);
	const dryRun = args.includes("--dry-run");
	const log = (line: string) => console.log(`  ${line}`);

	if (command === "local-media") {
		const uploadsDir = option("--uploads");
		if (!uploadsDir) usage();
		const r = await uploadLocalMedia({
			uploadsDir,
			attachments: JSON.parse(await readFile(join(prepared, "attachments.json"), "utf8")),
			imported: media,
			mcp,
			dryRun,
			log,
		});
		await writeFile(join(prepared, "local-media.json"), `${JSON.stringify(r, null, 2)}\n`);
		await writeFile(join(prepared, "media-merged.json"), `${JSON.stringify({ imported: [...media, ...r.uploaded] }, null, 2)}\n`);
		console.log(`Uploaded ${r.uploaded.length}, already imported ${r.alreadyImported}, missing ${r.missing.length}. Use ${join(prepared, "media-merged.json")} as --media for the next passes.`);
		for (const m of r.missing.slice(0, 20)) console.log(`  - ${m.url}: ${m.reason}`);
		if (r.missing.length) process.exitCode = 1;
	} else if (command === "fix-media") {
		const { legacyHosts } = JSON.parse(await readFile(join(prepared, "preflight.json"), "utf8"));
		const result = await fixMedia({ legacyHosts, media, mcp, dryRun, log, fetchMissing: args.includes("--fetch-missing"), uploadsDir: option("--uploads") });
		await writeFile(join(prepared, "fix-media.json"), `${JSON.stringify(result, null, 2)}\n`);
		const rewritten = result.entries.reduce((n, o) => n + o.rewritten, 0);
		const unresolved = [...new Set(result.entries.flatMap((o) => o.unresolved))];
		const failed = result.entries.filter((o) => o.error);
		console.log(`Rewrote ${rewritten} media reference(s) in ${result.entries.filter((o) => o.rewritten).length} entries; failed ${failed.length}`);
		if (unresolved.length) {
			console.log(`${unresolved.length} legacy URL(s) not in the media library (left unchanged):`);
			for (const url of unresolved.slice(0, 20)) console.log(`  - ${url}`);
		}
		if (failed.length) process.exitCode = 1;
	} else {
		const entries: ShortcodeEntry[] = JSON.parse(await readFile(join(prepared, "shortcodes.json"), "utf8"));
		const formIds = await readFile(join(prepared, "forms-report.json"), "utf8").then((t) => JSON.parse(t).ids, () => ({}));
		const outcomes = await fixShortcodes({ entries, media, mcp, dryRun, log, formIds, collections: await readImportCollections(prepared) });
		await writeFile(join(prepared, "fix-shortcodes.json"), `${JSON.stringify(outcomes, null, 2)}\n`);
		const replaced = outcomes.reduce((n, o) => n + o.replaced, 0);
		const stuck = outcomes.flatMap((o) => o.stuck);
		const external = outcomes.flatMap((o) => o.externalMedia);
		const failed = outcomes.filter((o) => o.error);
		console.log(`Replaced ${replaced} shortcode(s) in ${outcomes.length} entries; stuck ${stuck.length}; external media ${external.length}; failed ${failed.length}`);
		if (stuck.length || failed.length) process.exitCode = 1;
	}
} else {
	usage();
}
