/**
 * Run the redirects pass: plan from the export's permalinks and what's published on the
 * site, create the redirects through EmDash's API, then rewrite internal links in content.
 */

import { listCollections, listEntries, updateEntry } from "./entries.ts";
import { legacyUrlPattern } from "./legacy-hosts.ts";
import type { McpClient } from "./mcp-client.ts";
import type { Permalink } from "./permalinks.ts";
import { planRedirects, REDIRECT_GROUP, rewriteLinks, type PlannedRedirect, type SkippedRedirect } from "./redirects.ts";
import type { RestClient } from "./rest-client.ts";

export interface FixRedirectsOptions {
	permalinks: Permalink[];
	legacyHosts: string[];
	mcp: McpClient;
	rest: RestClient;
	collections?: Record<string, string>;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface RedirectsReport {
	created: PlannedRedirect[];
	failed: (PlannedRedirect & { error: string })[];
	skipped: SkippedRedirect[];
	links: { collection: string; slug: string; rewritten: number; unresolved: string[]; republished: boolean; error?: string }[];
}

export async function fixRedirects(options: FixRedirectsOptions): Promise<RedirectsReport> {
	const { mcp, rest, dryRun, log = () => {} } = options;
	const collections = options.collections ?? {};

	const infos = await listCollections(mcp);
	const urlPatterns = Object.fromEntries(infos.filter((c) => c.urlPattern).map((c) => [c.slug, c.urlPattern!]));
	const published: Record<string, Set<string>> = {};
	const ids = new Map<string, string[]>();
	for (const { slug } of infos) {
		const entries = await listEntries(mcp, slug);
		ids.set(slug, entries.map((e) => e.id));
		published[slug] = new Set(entries.filter((e) => e.status === "published" && e.slug).map((e) => e.slug!));
	}
	const existingSources = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await rest.get(`/redirects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
		for (const r of page.items ?? []) existingSources.add(r.source);
		cursor = page.nextCursor ?? undefined;
	} while (cursor);

	const plan = planRedirects({ permalinks: options.permalinks, collections, urlPatterns, published, existingSources });
	const report: RedirectsReport = { created: [], failed: [], skipped: plan.skipped, links: [] };

	for (const redirect of plan.create) {
		if (dryRun) {
			log(`would redirect ${redirect.source} -> ${redirect.destination}`);
			continue;
		}
		try {
			await rest.post("/redirects", { source: redirect.source, destination: redirect.destination, type: 301, groupName: REDIRECT_GROUP });
			report.created.push(redirect);
		} catch (error) {
			report.failed.push({ ...redirect, error: error instanceof Error ? error.message : String(error) });
		}
	}
	log(`redirects: ${report.created.length} created, ${report.failed.length} failed, ${plan.skipped.length} skipped`);

	const legacyUrl = legacyUrlPattern(options.legacyHosts);
	for (const [collection, list] of ids) {
		for (const id of list) {
			const { item, _rev } = await mcp.call("content_get", { collection, id });
			const outcome = { collection, slug: item.slug ?? id, rewritten: 0, unresolved: [] as string[], republished: false, error: undefined as string | undefined };
			const changed: Record<string, unknown> = {};
			for (const [field, value] of Object.entries(item.data ?? {})) {
				const result = rewriteLinks(value, legacyUrl, plan.map);
				outcome.unresolved.push(...result.unresolved);
				if (result.rewritten) {
					outcome.rewritten += result.rewritten;
					changed[field] = result.value;
				}
			}
			if (!outcome.rewritten && !outcome.unresolved.length) continue;
			report.links.push(outcome);
			if (!outcome.rewritten || dryRun) continue;
			try {
				outcome.republished = await updateEntry(mcp, collection, item, _rev, changed);
				log(`${collection}/${outcome.slug}: rewrote ${outcome.rewritten} internal link(s)`);
			} catch (error) {
				outcome.error = error instanceof Error ? error.message : String(error);
				log(`${collection}/${outcome.slug}: FAILED ${outcome.error}`);
			}
		}
	}
	return report;
}
