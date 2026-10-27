/**
 * Media metadata pass: EmDash's WordPress importer brings attachment files into the media
 * library but drops their alt text and captions. Restore them from the WXR over MCP.
 * Only empty fields are filled; anything an editor already set is left alone.
 */

import type { McpClient } from "./mcp-client.ts";
import type { ImportedMedia } from "./media.ts";
import { getField, readItems } from "./wxr.ts";

export interface AttachmentMetadata {
	wpId: number;
	alt?: string;
	caption?: string;
	title?: string;
}

/** What `media_update` accepts for the fields we restore */
export interface MediaUpdate {
	alt?: string;
	caption?: string;
}

export interface MediaMetadataOptions {
	metadata: AttachmentMetadata[];
	media: ImportedMedia[];
	mcp: McpClient;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface MediaMetadataReport {
	updated: number;
	/** Had metadata, but nothing in it was missing from the library item */
	skippedAlreadySet: number;
	/** Imported media with no attachment metadata in the export */
	noMetadata: number;
	/** Items that end up with no alt text, whether or not we changed them */
	missingAlt: number;
	errors: { mediaId: string; error: string }[];
}

export function readAttachmentMetadata(xml: string): AttachmentMetadata[] {
	const out: AttachmentMetadata[] = [];
	for (const { raw } of readItems(xml)) {
		if (getField(raw, "wp:post_type") !== "attachment") continue;
		const wpId = Number(getField(raw, "wp:post_id"));
		if (!wpId) continue;
		out.push({
			wpId,
			alt: clean(readMeta(raw).get("_wp_attachment_image_alt")),
			caption: clean(stripTags(getField(raw, "excerpt:encoded"))),
			title: clean(getField(raw, "title")),
		});
	}
	return out;
}

/** The update to send, or undefined when there is nothing to fill. Never overwrites a non-empty field. */
export function planMediaUpdate(
	metadata: AttachmentMetadata,
	current: { alt?: string | null; caption?: string | null },
): MediaUpdate | undefined {
	const update: MediaUpdate = {};
	if (metadata.alt && !current.alt?.trim()) update.alt = metadata.alt;
	if (metadata.caption && !current.caption?.trim()) update.caption = metadata.caption;
	return Object.keys(update).length ? update : undefined;
}

export async function fixMediaMetadata(options: MediaMetadataOptions): Promise<MediaMetadataReport> {
	const { mcp, dryRun, log = () => {} } = options;
	const byWpId = new Map(options.metadata.map((m) => [m.wpId, m]));
	const report: MediaMetadataReport = { updated: 0, skippedAlreadySet: 0, noMetadata: 0, missingAlt: 0, errors: [] };
	for (const media of options.media) {
		const metadata = byWpId.get(media.wpId);
		if (!metadata) {
			report.noMetadata++;
			log(`${media.mediaId}: no attachment metadata`);
			continue;
		}
		try {
			const got = await mcp.call("media_get", { id: media.mediaId });
			const current = got?.item ?? got ?? {};
			const update = planMediaUpdate(metadata, current);
			if (!(update?.alt ?? current.alt?.trim?.())) report.missingAlt++;
			if (!update) {
				report.skippedAlreadySet++;
				continue;
			}
			if (!dryRun) await mcp.call("media_update", { id: media.mediaId, ...update });
			report.updated++;
			log(`${media.mediaId}: set ${Object.keys(update).join(", ")}${dryRun ? " (dry run)" : ""}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			report.errors.push({ mediaId: media.mediaId, error: message });
			log(`${media.mediaId}: FAILED ${message}`);
		}
	}
	return report;
}

/** `<wp:postmeta>` key/value pairs, CDATA or plain */
function readMeta(raw: string): Map<string, string> {
	const meta = new Map<string, string>();
	for (const m of raw.matchAll(/<wp:postmeta>\s*<wp:meta_key>(?:<!\[CDATA\[)?([^<\]]*)(?:\]\]>)?<\/wp:meta_key>\s*<wp:meta_value>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/wp:meta_value>/g)) {
		meta.set(m[1], m[2]);
	}
	return meta;
}

function stripTags(html: string): string {
	return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

function clean(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}
