/**
 * Before import: run every pre-import pass over the export and collect the inputs the
 * post-import passes need. `writePrepared` saves them next to the prepared WXR.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readForms, removeFormItems, type FormSpec } from "./forms.ts";
import { findLegacyHosts } from "./legacy-hosts.ts";
import type { AttachmentRef } from "./local-media.ts";
import { readAttachmentMetadata, type AttachmentMetadata } from "./media-metadata.ts";
import { readMenus, type MenuSpec } from "./menus.ts";
import { readPermalinks, type Permalink } from "./permalinks.ts";
import { isPrivateHost, rehostExport, type Rehosted } from "./rehost.ts";
import { protectContent, type ProtectedItem } from "./protect.ts";
import { extractShortcodes, type ShortcodeEntry } from "./shortcodes.ts";
import { decodeSlugs, type DecodedSlug } from "./slugs.ts";
import { getField, readItems } from "./wxr.ts";

export interface Preflight {
	source: string;
	generatedAt: string;
	legacyHosts: string[];
	/** Set when `--production-url` put the live site's URL back into the export */
	rehosted?: Rehosted;
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
	/** Forms to create with the forms plugin (`fix-forms.ts`) */
	forms: FormSpec[];
	mediaMetadata: AttachmentMetadata[];
	/** Every attachment's original URL, for uploading from a local uploads folder */
	attachments: AttachmentRef[];
}

export function readAttachments(xml: string): AttachmentRef[] {
	return readItems(xml)
		.filter(({ raw }) => getField(raw, "wp:post_type") === "attachment")
		.map(({ raw }) => ({ wpId: Number(getField(raw, "wp:post_id")), url: getField(raw, "wp:attachment_url") }))
		.filter((a) => a.wpId && a.url);
}

export interface PrepareOptions {
	/** The live site's URL, replacing the export's own (e.g. localhost after a staging search-replace) */
	productionUrl?: string;
}

export function prepareExport(original: string, name: string, options: PrepareOptions = {}): PreparedExport {
	const { xml: source, rehosted } = options.productionUrl ? rehostExport(original, options.productionUrl) : { xml: original, rehosted: undefined };
	const protectedResult = protectContent(source);
	const slugResult = decodeSlugs(protectedResult.xml);
	const forms = readForms(source);
	const shortcodeResult = extractShortcodes(slugResult.xml, forms);
	return {
		// Form posts become plugin forms, not content
		xml: removeFormItems(shortcodeResult.xml),
		preflight: {
			source: name,
			generatedAt: new Date().toISOString(),
			// The original's hosts too: anything the rehost missed is still a leftover
			legacyHosts: [...new Set([...findLegacyHosts(source), ...findLegacyHosts(original)])].sort(),
			...(rehosted && { rehosted }),
			protected: protectedResult.protected,
			decodedSlugs: slugResult.decoded,
		},
		shortcodes: shortcodeResult.entries,
		permalinks: readPermalinks(source),
		menus: readMenus(source),
		forms: forms.forms,
		mediaMetadata: readAttachmentMetadata(source),
		attachments: readAttachments(source),
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
		`  ${menus.length} menu(s): ${menus.map((m) => `${m.slug} (${m.items.length})`).join(", ") || "none"}${menus.length ? ` (none assigned yet; to use one as the site menu: --assign primary=<slug>, e.g. primary=${menus[0].slug})` : ""}`,
		`  legacy hosts: ${preflight.legacyHosts.join(", ") || "none found"}`,
		...(preflight.rehosted ? [`  rewrote ${preflight.rehosted.replacements} URL(s) from ${preflight.rehosted.from} to ${preflight.rehosted.to}`] : []),
		...privateHostWarning(preflight),
		`  ${prepared.forms.length} form(s) will be created: ${prepared.forms.map((f) => `${f.slug} (${f.source}, ${f.pages[0].fields.length} fields)`).join(", ") || "none"}`,
		...prepared.forms.flatMap((f) => f.notes.map((n) => `    ! ${f.slug}: ${n}`)),
		...shortcodes.filter((e) => e.problem).map((p) => `    ! left as text in /${p.slug}: ${p.problem} — ${p.raw.slice(0, 80)}`),
	];
}

/** F27: an export taken after a search-replace to a local URL can't go live as it stands. */
function privateHostWarning(preflight: Preflight): string[] {
	const fromHost = preflight.rehosted && new URL(preflight.rehosted.from).hostname;
	const hosts = preflight.legacyHosts.filter((h) => isPrivateHost(h) && h !== fromHost);
	if (!hosts.length) return [];
	return [
		`  ! local or private legacy host: ${hosts.join(", ")}. The export was probably taken after a search-replace to a local URL.`,
		"    Media can't be downloaded from it (use --uploads with a copy of wp-content/uploads), and links to it will fail the go-live check.",
		"    Export before the search-replace, or pass --production-url https://<live site> to put the live URL back.",
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
	await write("forms.json", prepared.forms);
	await write("media-metadata.json", prepared.mediaMetadata);
	await write("attachments.json", prepared.attachments);
	return preparedPath;
}
