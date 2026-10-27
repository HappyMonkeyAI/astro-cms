/**
 * Before import: run every pre-import pass over the export and collect the inputs the
 * post-import passes need. `writePrepared` saves them next to the prepared WXR.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { findLegacyHosts } from "./legacy-hosts.ts";
import { readAttachmentMetadata, type AttachmentMetadata } from "./media-metadata.ts";
import { readMenus, type MenuSpec } from "./menus.ts";
import { readPermalinks, type Permalink } from "./permalinks.ts";
import { protectContent, type ProtectedItem } from "./protect.ts";
import { extractShortcodes, type ShortcodeEntry } from "./shortcodes.ts";
import { decodeSlugs, type DecodedSlug } from "./slugs.ts";

export interface Preflight {
	source: string;
	generatedAt: string;
	legacyHosts: string[];
	protected: ProtectedItem[];
	decodedSlugs: DecodedSlug[];
}

export interface PreparedExport {
	/** The WXR to import */
	xml: string;
	preflight: Preflight;
	shortcodes: ShortcodeEntry[];
	permalinks: Permalink[];
	menus: MenuSpec[];
	mediaMetadata: AttachmentMetadata[];
}

export function prepareExport(source: string, name: string): PreparedExport {
	const protectedResult = protectContent(source);
	const slugResult = decodeSlugs(protectedResult.xml);
	const shortcodeResult = extractShortcodes(slugResult.xml);
	return {
		xml: shortcodeResult.xml,
		preflight: {
			source: name,
			generatedAt: new Date().toISOString(),
			legacyHosts: findLegacyHosts(source),
			protected: protectedResult.protected,
			decodedSlugs: slugResult.decoded,
		},
		shortcodes: shortcodeResult.entries,
		permalinks: readPermalinks(source),
		menus: readMenus(source),
		mediaMetadata: readAttachmentMetadata(source),
	};
}

/** Human-readable summary of what the passes will do. */
export function describePrepared(prepared: PreparedExport): string[] {
	const { preflight, shortcodes, menus } = prepared;
	const converted = shortcodes.filter((e) => e.data);
	const byKind = Object.entries(converted.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.data!.kind]: (acc[e.data!.kind] ?? 0) + 1 }), {}));
	return [
		`${preflight.source}:`,
		`  ${preflight.protected.length} protected item(s) will be imported as drafts`,
		...preflight.protected.map((i) => `    - [${i.reason}] ${i.type} "${i.title}" (/${i.slug}, was ${i.originalStatus})`),
		`  ${converted.length} shortcode(s) will be converted: ${byKind.map(([k, n]) => `${n} ${k}`).join(", ") || "none"}`,
		`  ${preflight.decodedSlugs.length} percent-encoded slug(s) will be decoded (EmDash can't serve them encoded)`,
		`  ${menus.length} menu(s): ${menus.map((m) => `${m.slug} (${m.items.length})`).join(", ") || "none"}`,
		`  legacy hosts: ${preflight.legacyHosts.join(", ") || "none found"}`,
		...shortcodes.filter((e) => e.problem).map((p) => `    ! left as text in /${p.slug}: ${p.problem} — ${p.raw.slice(0, 80)}`),
	];
}

/** Writes `<stem>.prepared.xml` and the pass inputs; returns the prepared WXR's path. */
export async function writePrepared(outDir: string, stem: string, prepared: PreparedExport): Promise<string> {
	await mkdir(outDir, { recursive: true });
	const write = (file: string, data: unknown) => writeFile(join(outDir, file), `${JSON.stringify(data, null, 2)}\n`);
	const preparedPath = resolve(join(outDir, `${stem}.prepared.xml`));
	await writeFile(preparedPath, prepared.xml);
	await write("preflight.json", prepared.preflight);
	await write("shortcodes.json", prepared.shortcodes);
	await write("permalinks.json", prepared.permalinks);
	await write("menus.json", prepared.menus);
	await write("media-metadata.json", prepared.mediaMetadata);
	return preparedPath;
}
