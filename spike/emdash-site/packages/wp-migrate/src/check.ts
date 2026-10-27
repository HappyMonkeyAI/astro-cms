/**
 * Go-live check (last step). SPEC §5.2: the site isn't ready until `migration-guard`
 * reports 0 issues. We hand the plugin the export's legacy hosts (it saves them, so its
 * publish gate keeps blocking old-host URLs afterwards), run its scan, and also look for
 * shortcode markers our own passes would have left, which the plugin doesn't know about.
 */

import { listCollections, listEntryIds } from "./entries.ts";
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
	legacyHosts: string[];
}

export async function goLiveCheck(options: { rest: RestClient; mcp: McpClient; legacyHosts: string[] }): Promise<GoLiveReport> {
	const { rest, mcp, legacyHosts } = options;
	let scan: { ok?: boolean; scanned?: number; error?: string };
	try {
		scan = await rest.post(`${PLUGIN}/scan`, { legacyHosts });
	} catch (error) {
		throw new Error(`migration-guard isn't available on this site, so the go-live check can't run: ${error instanceof Error ? error.message : error}`);
	}
	if (!scan.ok) throw new Error(`migration-guard scan failed: ${scan.error ?? "unknown error"}`);

	const issues: GoLiveIssue[] = [];
	const found = await rest.post(`${PLUGIN}/issues`, { limit: 200 });
	for (const item of found.items ?? []) {
		issues.push({ collection: item.collection, slug: item.slug ?? item.entryId, problem: describeIssue(item) });
	}

	const pendingDrafts: GoLiveReport["pendingDrafts"] = [];
	for (const { slug: collection } of await listCollections(mcp)) {
		for (const id of await listEntryIds(mcp, collection)) {
			const { item } = await mcp.call("content_get", { collection, id });
			const markers = JSON.stringify(item.data ?? {}).match(MARKER_PATTERN);
			if (markers) issues.push({ collection, slug: item.slug ?? id, problem: `${markers.length} unconverted shortcode marker(s)` });
			if (item.status === "published" && item.draftRevisionId) pendingDrafts.push({ collection, slug: item.slug ?? id });
		}
	}
	return { ready: issues.length === 0, scanned: scan.scanned ?? 0, issues, pendingDrafts, legacyHosts };
}

function describeIssue(item: { shortcodes?: Record<string, number>; legacyUrls?: number }): string {
	const parts = Object.entries(item.shortcodes ?? {}).map(([name, n]) => `${n}× [${name}]`);
	if (item.legacyUrls) parts.push(`${item.legacyUrls} legacy-host URL(s)`);
	return parts.join(", ") || "flagged by migration-guard";
}
