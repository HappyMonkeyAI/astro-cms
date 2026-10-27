/**
 * Pass: shortcodes, part 2 of 2 (after import). See `shortcodes.ts` for part 1.
 *
 * For each entry that had shortcodes: read it over MCP, replace markers with real
 * blocks, write it back with its `_rev`, and re-publish it if it was published (edits
 * to published entries are staged as drafts). Media resolves to the new library.
 */

import { buildBlocks } from "./blocks.ts";
import { updateEntry } from "./entries.ts";
import type { McpClient } from "./mcp-client.ts";
import { createMediaResolver, type ImportedMedia } from "./media.ts";
import { replaceMarkers, type PtBlock } from "./portable-text.ts";
import type { ShortcodeEntry } from "./shortcodes.ts";

export interface FixShortcodesOptions {
	entries: ShortcodeEntry[];
	media: ImportedMedia[];
	mcp: McpClient;
	/** WordPress post type → EmDash collection. @default post→posts, page→pages */
	collections?: Record<string, string>;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface EntryOutcome {
	collection: string;
	slug: string;
	replaced: number;
	stuck: string[];
	externalMedia: string[];
	republished: boolean;
	error?: string;
}

export async function fixShortcodes(options: FixShortcodesOptions): Promise<EntryOutcome[]> {
	const { mcp, dryRun, log = () => {} } = options;
	const collections = { post: "posts", page: "pages", ...options.collections };
	const resolve = createMediaResolver(options.media);
	const byMarker = new Map(options.entries.filter((e) => e.data).map((e) => [e.marker, e]));
	const posts = new Map<number, ShortcodeEntry[]>();
	for (const entry of byMarker.values()) posts.set(entry.wpPostId, [...(posts.get(entry.wpPostId) ?? []), entry]);

	let counter = 0;
	const newKey = () => `wpm-${Date.now().toString(36)}-${(counter++).toString(36)}`;
	const outcomes: EntryOutcome[] = [];

	for (const [, group] of posts) {
		const { postType, slug } = group[0];
		const collection = collections[postType] ?? `${postType}s`;
		const outcome: EntryOutcome = { collection, slug, replaced: 0, stuck: [], externalMedia: [], republished: false };
		outcomes.push(outcome);
		try {
			if (!slug) throw new Error("entry has no slug in the export");
			const { item, _rev } = await mcp.call("content_get", { collection, id: slug });
			const data: Record<string, unknown> = {};
			for (const [field, value] of Object.entries(item.data ?? {})) {
				if (!isPortableText(value)) continue;
				const result = replaceMarkers(
					value,
					(marker) => {
						const entry = byMarker.get(marker);
						return entry?.data && buildBlocks(entry.data, resolve, newKey, (url) => outcome.externalMedia.push(url));
					},
					newKey,
				);
				outcome.stuck.push(...result.stuck);
				if (result.replaced.length) {
					outcome.replaced += result.replaced.length;
					data[field] = result.blocks;
				}
			}
			if (!Object.keys(data).length || dryRun) {
				log(`${collection}/${slug}: ${outcome.replaced} to replace${dryRun ? " (dry run)" : ""}`);
				continue;
			}
			outcome.republished = await updateEntry(mcp, collection, item, _rev, data);
			log(`${collection}/${slug}: replaced ${outcome.replaced}${outcome.republished ? ", republished" : ""}`);
		} catch (error) {
			outcome.error = error instanceof Error ? error.message : String(error);
			log(`${collection}/${slug}: FAILED ${outcome.error}`);
		}
	}
	return outcomes;
}

function isPortableText(value: unknown): value is PtBlock[] {
	return Array.isArray(value) && value.some((b) => b && typeof b === "object" && "_type" in b);
}
