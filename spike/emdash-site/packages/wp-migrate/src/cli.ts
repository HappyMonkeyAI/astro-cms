#!/usr/bin/env node
/**
 * wp-migrate: WordPress → EmDash migration around EmDash's own importer.
 *
 *   wp-migrate preflight <export.xml>                  report what needs attention; changes nothing
 *   wp-migrate prepare   <export.xml> --out <dir>      write <dir>/<name>.prepared.xml to import, plus
 *                                                      preflight.json and shortcodes.json
 *   (import the prepared file with EmDash, including media)
 *   wp-migrate fix-shortcodes --prepared <dir> --media <media-report.json> --base <site-url> [--dry-run]
 *                                                      replace shortcode markers with real blocks over MCP
 *                                                      (token: EMDASH_TOKEN, admin scope)
 *
 * Import the prepared file, never the original.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { fixShortcodes } from "./fix-shortcodes.ts";
import { connectMcp } from "./mcp-client.ts";
import { protectContent } from "./protect.ts";
import { extractShortcodes, type ShortcodeEntry } from "./shortcodes.ts";

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};
const positional = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

function usage(): never {
	console.error(
		[
			"Usage: wp-migrate preflight <export.xml>",
			"       wp-migrate prepare <export.xml> --out <dir>",
			"       wp-migrate fix-shortcodes --prepared <dir> --media <media-report.json> --base <site-url> [--dry-run]",
		].join("\n"),
	);
	process.exit(2);
}

if (command === "preflight" || command === "prepare") {
	if (!positional) usage();
	const source = await readFile(positional, "utf8");
	const protectedResult = protectContent(source);
	const shortcodeResult = extractShortcodes(protectedResult.xml);
	const converted = shortcodeResult.entries.filter((e) => e.data);
	const problems = shortcodeResult.entries.filter((e) => e.problem);

	console.log(`${basename(positional)}:`);
	console.log(`  ${protectedResult.protected.length} protected item(s) will be imported as drafts`);
	for (const item of protectedResult.protected) {
		console.log(`    - [${item.reason}] ${item.type} "${item.title}" (/${item.slug}, was ${item.originalStatus})`);
	}
	const byKind = Object.entries(
		converted.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.data!.kind]: (acc[e.data!.kind] ?? 0) + 1 }), {}),
	);
	console.log(`  ${converted.length} shortcode(s) will be converted: ${byKind.map(([k, n]) => `${n} ${k}`).join(", ") || "none"}`);
	for (const p of problems) console.log(`    ! left as text in /${p.slug}: ${p.problem} — ${p.raw.slice(0, 80)}`);

	if (command === "prepare") {
		const outDir = option("--out");
		if (!outDir) usage();
		await mkdir(outDir, { recursive: true });
		const stem = basename(positional).replace(/\.xml$/i, "");
		const preparedPath = resolve(join(outDir, `${stem}.prepared.xml`));
		await writeFile(preparedPath, shortcodeResult.xml);
		const report = { source: basename(positional), generatedAt: new Date().toISOString(), protected: protectedResult.protected };
		await writeFile(join(outDir, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`);
		await writeFile(join(outDir, "shortcodes.json"), `${JSON.stringify(shortcodeResult.entries, null, 2)}\n`);
		console.log(`Wrote ${preparedPath}, preflight.json and shortcodes.json. Import the prepared file, not the original.`);
	}
} else if (command === "fix-shortcodes") {
	const prepared = option("--prepared");
	const mediaPath = option("--media");
	const base = option("--base");
	const token = process.env.EMDASH_TOKEN;
	if (!prepared || !mediaPath || !base) usage();
	if (!token) {
		console.error("Set EMDASH_TOKEN to an admin-scope API token for the site.");
		process.exit(2);
	}
	const entries: ShortcodeEntry[] = JSON.parse(await readFile(join(prepared, "shortcodes.json"), "utf8"));
	const mediaReport = JSON.parse(await readFile(mediaPath, "utf8"));
	const outcomes = await fixShortcodes({
		entries,
		media: mediaReport.imported ?? [],
		mcp: await connectMcp(base, token),
		dryRun: args.includes("--dry-run"),
		log: (line) => console.log(`  ${line}`),
	});
	await writeFile(join(prepared, "fix-shortcodes.json"), `${JSON.stringify(outcomes, null, 2)}\n`);
	const replaced = outcomes.reduce((n, o) => n + o.replaced, 0);
	const stuck = outcomes.flatMap((o) => o.stuck);
	const external = outcomes.flatMap((o) => o.externalMedia);
	const failed = outcomes.filter((o) => o.error);
	console.log(`Replaced ${replaced} shortcode(s) in ${outcomes.length} entries; stuck ${stuck.length}; external media ${external.length}; failed ${failed.length}`);
	if (stuck.length || failed.length) process.exitCode = 1;
} else {
	usage();
}
