/**
 * Run the menus pass over MCP: create (or update) one EmDash menu per WordPress menu,
 * named after the WordPress menu slug, and optionally copy a WordPress menu into an
 * existing site menu such as the template's `primary` (theme locations aren't in WXR).
 */

import { toCollection } from "./collections.ts";
import { asItems, listCollections, listEntries } from "./entries.ts";
import { legacyUrlPattern } from "./legacy-hosts.ts";
import type { McpClient } from "./mcp-client.ts";
import { planMenuItems, type MenuSpec } from "./menus.ts";
import type { Permalink } from "./permalinks.ts";
import { planRedirects, rewriteLinks } from "./redirects.ts";

export interface FixMenusOptions {
	menus: MenuSpec[];
	permalinks: Permalink[];
	legacyHosts: string[];
	mcp: McpClient;
	/** EmDash menu name → WordPress menu slug, e.g. { primary: "main-menu" } */
	assign?: Record<string, string>;
	collections?: Record<string, string>;
	/** WordPress taxonomy → EmDash taxonomy. @default category→category, post_tag→tag */
	taxonomies?: Record<string, string>;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface MenuOutcome {
	menu: string;
	from: string;
	items: number;
	dropped: { label: string; reason: string }[];
	unresolvedUrls: string[];
	created: boolean;
	error?: string;
}

export async function fixMenus(options: FixMenusOptions): Promise<MenuOutcome[]> {
	const { mcp, dryRun, log = () => {} } = options;
	const collections = options.collections ?? {};
	const taxonomies = { category: "category", post_tag: "tag", ...options.taxonomies };

	const infos = await listCollections(mcp);
	const published: Record<string, Set<string>> = {};
	const ids = new Map<string, string>();
	for (const { slug } of infos) {
		published[slug] = new Set();
		for (const e of await listEntries(mcp, slug, ["published"])) {
			if (!e.slug) continue;
			published[slug].add(e.slug);
			ids.set(`${slug}:${e.slug}`, e.id);
		}
	}
	const terms = new Map<string, string>();
	for (const taxonomy of new Set(Object.values(taxonomies))) {
		let cursor: string | undefined;
		do {
			const page = await mcp.call("taxonomy_list_terms", { taxonomy, limit: 100, ...(cursor ? { cursor } : {}) }).catch(() => undefined);
			for (const t of asItems(page)) terms.set(`${taxonomy}:${t.slug}`, t.id);
			cursor = page?.nextCursor ?? undefined;
		} while (cursor);
	}
	const urlPatterns = Object.fromEntries(infos.filter((c) => c.urlPattern).map((c) => [c.slug, c.urlPattern!]));
	const { map } = planRedirects({ permalinks: options.permalinks, collections, urlPatterns, published, existingSources: new Set() });
	const legacyUrl = legacyUrlPattern(options.legacyHosts);

	const existing = new Set(asItems(await mcp.call("menu_list", {})).map((m: any) => m.name));
	const jobs = [
		...options.menus.map((menu) => ({ name: toMenuName(menu.slug), menu })),
		...Object.entries(options.assign ?? {}).map(([name, from]) => ({ name, menu: findMenu(options.menus, from) })),
	];
	const outcomes: MenuOutcome[] = [];
	for (const { name, menu } of jobs) {
		if (!menu) {
			const available = options.menus.map((m) => m.slug).join(", ") || "none";
			outcomes.push({ menu: name, from: "", items: 0, dropped: [], unresolvedUrls: [], created: false, error: `no such WordPress menu in the export (menus: ${available})` });
			continue;
		}
		const unresolvedUrls: string[] = [];
		const plan = planMenuItems(menu, {
			entry: (postType, slug) => {
				const collection = toCollection(postType, collections);
				const id = ids.get(`${collection}:${slug}`);
				return id ? { collection, id } : undefined;
			},
			term: (taxonomy, slug) => {
				const name = taxonomies[taxonomy] ?? taxonomy;
				const id = terms.get(`${name}:${slug}`);
				return id ? { taxonomy: name, id } : undefined;
			},
			url: (url) => {
				const result = rewriteLinks(url, legacyUrl, map);
				unresolvedUrls.push(...result.unresolved);
				return result.value;
			},
		});
		const outcome: MenuOutcome = { menu: name, from: menu.slug, items: plan.items.length, dropped: plan.dropped, unresolvedUrls, created: false };
		outcomes.push(outcome);
		if (dryRun) {
			log(`menu ${name} <- ${menu.slug}: ${plan.items.length} items, ${plan.dropped.length} dropped (dry run)`);
			continue;
		}
		try {
			if (!existing.has(name)) {
				await mcp.call("menu_create", { name, label: menu.label });
				existing.add(name);
				outcome.created = true;
			}
			await mcp.call("menu_set_items", { name, items: plan.items });
			log(`menu ${name} <- ${menu.slug}: ${plan.items.length} items${plan.dropped.length ? `, ${plan.dropped.length} dropped` : ""}`);
		} catch (error) {
			outcome.error = error instanceof Error ? error.message : String(error);
			log(`menu ${name}: FAILED ${outcome.error}`);
		}
	}
	return outcomes;
}

/** EmDash menu names must match /^[a-z][a-z0-9_]*$/; WordPress menu slugs use hyphens and may be non-ASCII. */
/**
 * The WordPress menu `--assign` names: its slug, its EmDash name (`main_menu` for `main-menu`)
 * or its label, ignoring case. The pilot tripped over hyphens vs underscores.
 */
export function findMenu(menus: MenuSpec[], ref: string): MenuSpec | undefined {
	const wanted = ref.trim().toLowerCase();
	return (
		menus.find((m) => m.slug === ref) ??
		menus.find((m) => m.slug.toLowerCase() === wanted || m.label.trim().toLowerCase() === wanted) ??
		menus.find((m) => toMenuName(m.slug) === toMenuName(ref))
	);
}

export function toMenuName(slug: string): string {
	const name = slug
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return /^[a-z]/.test(name) ? name : `menu_${name || "unnamed"}`;
}
