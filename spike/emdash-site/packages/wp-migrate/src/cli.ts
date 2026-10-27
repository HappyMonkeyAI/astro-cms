#!/usr/bin/env node
/**
 * wp-migrate: WordPress → EmDash migration around EmDash's own importer.
 *
 *   wp-migrate preflight <export.xml>               report what needs attention; changes nothing
 *   wp-migrate prepare   <export.xml> --out <dir>   write a cleaned WXR to import, plus the report
 *
 * Import the cleaned file (`<name>.prepared.xml`), never the original.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { protectContent } from "./protect.ts";

const [command, input, ...rest] = process.argv.slice(2);
const option = (name: string) => {
	const i = rest.indexOf(name);
	return i === -1 ? undefined : rest[i + 1];
};

function usage(): never {
	console.error("Usage: wp-migrate preflight <export.xml>\n       wp-migrate prepare <export.xml> --out <dir>");
	process.exit(2);
}

if (!input || (command !== "preflight" && command !== "prepare")) usage();

const source = await readFile(input, "utf8");
const result = protectContent(source);
const report = {
	source: basename(input),
	generatedAt: new Date().toISOString(),
	protected: result.protected,
};

console.log(`${report.source}: ${result.protected.length} protected item(s) will be imported as drafts`);
for (const item of result.protected) {
	console.log(`  - [${item.reason}] ${item.type} "${item.title}" (/${item.slug}, was ${item.originalStatus})`);
}

if (command === "prepare") {
	const outDir = option("--out");
	if (!outDir) usage();
	await mkdir(outDir, { recursive: true });
	const stem = basename(input).replace(/\.xml$/i, "");
	const preparedPath = resolve(join(outDir, `${stem}.prepared.xml`));
	await writeFile(preparedPath, result.xml);
	await writeFile(join(outDir, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Wrote ${preparedPath} and preflight.json. Import the prepared file, not the original.`);
}
