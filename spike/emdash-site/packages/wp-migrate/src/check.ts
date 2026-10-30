/**
 * Go-live check (last step). SPEC §5.2: the site isn't ready until `migration-guard`
 * reports 0 issues. We hand the plugin the export's legacy hosts (it saves them, so its
 * publish gate keeps blocking old-host URLs afterwards), run its scan, and also look for
 * shortcode markers our own passes would have left, which the plugin doesn't know about.
 *
 * Only what visitors can see blocks going live. Leftovers in a collection with no public URL
 * (e.g. imported page-builder templates) are listed under `notPublic` for review instead.
 */

import { listCollections, listEntryIds, publicCollections } from "./entries.ts";
import type { McpClient } from "./mcp-client.ts";
import type { RestClient } from "./rest-client.ts";
import { MARKER_PATTERN } from "./shortcodes.ts";

const PLUGIN = "/plugins/migration-guard";

export interface GoLiveIssue {
	collection: string;
	slug: string;
	problem: string;
}

export interface GoLiveReport {
	ready: boolean;
	scanned: number;
	issues: GoLiveIssue[];
	/**
	 * Published entries with unpublished changes. The scans read the live version, so a
	 * leftover in a pending draft isn't counted as an issue (visitors can't see it, and
	 * migration-guard blocks publishing it); these are listed for review, not blocking.
	 */
	pendingDrafts: { collection: string; slug: string }[];
	/**
	 * Issues in collections visitors can't reach (no URL pattern, or not routable): listed for
	 * review, not blocking. They block again if the collection is given a public URL.
	 */
	notPublic: GoLiveIssue[];
	legacyHosts: string[];
}

export async function goLiveCheck(options: { rest: RestClient; mcp: McpClient; legacyHosts: string[] }): Promise<GoLiveReport> {
	const { rest, mcp, legacyHosts } = options;
	let scan: { ok?: boolean; scanned?: number; error?: string };
	try {
		scan = await rest.post(`${PLUGIN}/scan`, { legacyHosts });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Only a missing route means the plugin isn't installed; anything else is a scan failure
		if (/-> 404\b/.test(message)) throw new Error(`migration-guard isn't available on this site, so the go-live check can't run: ${message}`);
		throw new Error(`migration-guard scan failed, so the go-live check can't run: ${message}`);
	}
	if (!scan.ok) throw new Error(`migration-guard scan failed: ${scan.error ?? "unknown error"}`);

	const collections = await listCollections(mcp);
	const issues: GoLiveIssue[] = [];
	const found = await rest.post(`${PLUGIN}/issues`, { limit: 200 });
	for (const item of found.items ?? []) {
		issues.push({ collection: item.collection, slug: item.entrySlug ?? item.slug ?? item.entryId, problem: describeIssue(item) });
	}

	const pendingDrafts: GoLiveReport["pendingDrafts"] = [];
	for (const { slug: collection } of collections) {
		for (const id of await listEntryIds(mcp, collection)) {
			const { item } = await mcp.call("content_get", { collection, id });
			const markers = JSON.stringify(item.data ?? {}).match(MARKER_PATTERN);
			if (markers) issues.push({ collection, slug: item.slug ?? id, problem: `${markers.length} unconverted shortcode marker(s)` });
			if (item.status === "published" && item.draftRevisionId) pendingDrafts.push({ collection, slug: item.slug ?? id });
		}
	}
	const isPublic = publicCollections(collections);
	const blocking = issues.filter((i) => isPublic(i.collection));
	const notPublic = issues.filter((i) => !isPublic(i.collection));
	return { ready: blocking.length === 0, scanned: scan.scanned ?? 0, issues: blocking, pendingDrafts, notPublic, legacyHosts };
}

function describeIssue(item: { shortcodes?: Record<string, number>; legacyUrls?: number }): string {
	const parts = Object.entries(item.shortcodes ?? {}).map(([name, n]) => `${n}× [${name}]`);
	if (item.legacyUrls) parts.push(`${item.legacyUrls} legacy-host URL(s)`);
	return parts.join(", ") || "flagged by migration-guard";
}
