/**
 * Shared MCP plumbing for post-import passes: enumerate every entry in every
 * collection, and write changed fields back (with `_rev`), re-publishing entries
 * that were published, since edits to published entries are staged as drafts.
 */

import type { McpClient } from "./mcp-client.ts";

const STATUSES = ["draft", "published", "scheduled"] as const;

export interface CollectionInfo {
	slug: string;
	urlPattern?: string;
	routable?: boolean;
}

/**
 * Whether visitors can reach a collection's entries, judged against the whole collection list.
 * EmDash omits `urlPattern` when a collection has none (e.g. imported page-builder templates), so a
 * missing pattern means "no public URL" only when the list reports patterns at all. Fails closed:
 * an unknown collection, or a list with no URL information, counts as public.
 */
export function publicCollections(collections: CollectionInfo[]): (slug: string) => boolean {
	const reportsUrls = collections.some((c) => c.urlPattern);
	return (slug) => {
		const c = collections.find((x) => x.slug === slug);
		if (!c) return true;
		if (c.routable === false) return false;
		return !reportsUrls || Boolean(c.urlPattern);
	};
}

export async function listCollections(mcp: McpClient): Promise<CollectionInfo[]> {
	return asItems(await mcp.call("schema_list_collections", {}));
}

/** Entry summaries (id, slug, status, …) in a collection, across the given statuses. */
export async function listEntries(
	mcp: McpClient,
	collection: string,
	statuses: readonly string[] = STATUSES,
): Promise<{ id: string; slug?: string; status?: string }[]> {
	const entries = new Map<string, { id: string; slug?: string; status?: string }>();
	for (const status of statuses) {
		let cursor: string | undefined;
		do {
			const page = await mcp.call("content_list", { collection, status, limit: 100, ...(cursor ? { cursor } : {}) });
			for (const item of asItems(page)) entries.set(item.id, item);
			cursor = page?.nextCursor ?? undefined;
		} while (cursor);
	}
	return [...entries.values()];
}

export async function listEntryIds(mcp: McpClient, collection: string, statuses?: readonly string[]): Promise<string[]> {
	return (await listEntries(mcp, collection, statuses)).map((e) => e.id);
}

/** Write `changed` fields; re-publish if the entry was published. Returns whether it was re-published. */
export async function updateEntry(
	mcp: McpClient,
	collection: string,
	item: { id: string; status?: string },
	rev: string,
	changed: Record<string, unknown>,
): Promise<boolean> {
	await mcp.call("content_update", { collection, id: item.id, _rev: rev, data: changed });
	if (item.status !== "published") return false;
	const fresh = await mcp.call("content_get", { collection, id: item.id });
	await mcp.call("content_publish", { collection, id: item.id, _rev: fresh._rev });
	return true;
}

export function asItems(page: any): any[] {
	return Array.isArray(page) ? page : (page?.items ?? page?.collections ?? []);
}
