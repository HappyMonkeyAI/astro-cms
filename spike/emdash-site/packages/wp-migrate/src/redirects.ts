/**
 * Pass: redirects and internal links (after import). SPEC §5.2, spike F13.
 *
 * Old permalinks 404 after migration and nested page paths are flattened (EmDash
 * pages have no parent). We create EmDash core redirects (301, group `wp-migrate`)
 * from each old path to the entry's new URL, and rewrite links inside content that
 * still point at old pages, so visitors don't take a redirect hop.
 */

import type { Permalink } from "./permalinks.ts";
import { decodeSlug } from "./slugs.ts";

export const REDIRECT_GROUP = "wp-migrate";

export interface PlannedRedirect {
	source: string;
	destination: string;
	wpId: number;
}

export interface SkippedRedirect {
	path?: string;
	wpId: number;
	reason: string;
}

export interface PlanInput {
	permalinks: Permalink[];
	/** WordPress post type → EmDash collection */
	collections: Record<string, string>;
	/** EmDash collection → URL pattern containing `{slug}` */
	urlPatterns: Record<string, string>;
	/** Published slugs per EmDash collection */
	published: Record<string, Set<string>>;
	/** Redirect sources that already exist on the site */
	existingSources: Set<string>;
}

export function planRedirects(input: PlanInput): { create: PlannedRedirect[]; skipped: SkippedRedirect[]; map: Map<string, string> } {
	const create: PlannedRedirect[] = [];
	const skipped: SkippedRedirect[] = [];
	/** Normalised old path → new path, for every published entry (also used for link rewriting) */
	const map = new Map<string, string>();
	const existing = new Set([...input.existingSources].map(normalisePath));

	for (const p of input.permalinks) {
		const skip = (reason: string) => skipped.push({ path: p.path, wpId: p.wpId, reason });
		const collection = input.collections[p.postType] ?? `${p.postType}s`;
		const pattern = input.urlPatterns[collection];
		if (!p.path) {
			skip("plain permalink (?p=) can't be redirected by path");
			continue;
		}
		if (!pattern) {
			skip(`collection ${collection} has no URL pattern`);
			continue;
		}
		if (!p.slug || !input.published[collection]?.has(p.slug)) {
			skip("not published on the new site");
			continue;
		}
		const destination = pattern.replace("{slug}", encodeURIComponent(p.slug));
		// Browsers request non-ASCII paths percent-encoded, and the redirect middleware matches that form
		const source = encodeURI(p.path);
		const key = normalisePath(source);
		map.set(key, destination);
		if (key === normalisePath(destination)) skip("URL unchanged");
		else if (key === "/") skip("site root");
		else if (existing.has(key)) skip("redirect already exists");
		else {
			existing.add(key);
			create.push({ source, destination, wpId: p.wpId });
		}
	}
	return { create, skipped, map };
}

/** Comparison key for paths: decoded, no trailing slash, lower-case. */
export function normalisePath(path: string): string {
	const trimmed = decodeSlug(path).replace(/\/+$/, "");
	return (trimmed || "/").toLowerCase();
}

/**
 * Rewrite links to old pages inside any stored value. Media URLs have already been
 * handled by fix-media, so remaining legacy URLs are page links: those whose path is a
 * known permalink become the new site-relative URL (keeping any #fragment); the site
 * root becomes `/`; anything else is reported and left alone.
 */
export function rewriteLinks<T>(value: T, legacyUrl: RegExp, map: Map<string, string>) {
	let rewritten = 0;
	const unresolved: string[] = [];
	const walk = (node: unknown): unknown => {
		if (typeof node === "string") {
			return node.replace(new RegExp(legacyUrl.source, "gi"), (url) => {
				let parsed: URL;
				try {
					parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
				} catch {
					unresolved.push(url);
					return url;
				}
				const key = normalisePath(parsed.pathname.replace(/\/{2,}/g, "/"));
				const destination = key === "/" && !parsed.search ? "/" : parsed.search ? undefined : map.get(key);
				if (!destination) {
					unresolved.push(url);
					return url;
				}
				rewritten++;
				return destination + parsed.hash;
			});
		}
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
		return node;
	};
	return { value: walk(value) as T, rewritten, unresolved };
}
