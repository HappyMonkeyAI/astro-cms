/**
 * Pass: media URLs (after import). SPEC §5.2, spike F13/F15.
 *
 * EmDash's `rewrite-urls` step only rewrites exact attachment URLs, so size variants,
 * `?w=` resized URLs, gallery/cover/file/embed URLs and links stay on the old host, and
 * imported images keep WordPress attachment IDs as their `_ref`. This walks any stored
 * value (all Portable Text shapes, nested columns, other fields) and:
 * - points `asset` references at the media library item (both `_ref` and `url`), and
 * - replaces every other legacy media URL inside strings (incl. embed HTML) in place.
 * URLs that don't resolve to imported media are reported, not changed.
 */

import type { ResolvedMedia } from "./media.ts";

export interface RewriteOptions {
	legacyUrl: RegExp;
	resolve: (ref: { attachmentId?: number; url: string }) => ResolvedMedia;
}

export interface RewriteResult<T> {
	value: T;
	rewritten: number;
	unresolved: string[];
}

export function rewriteMediaRefs<T>(value: T, options: RewriteOptions): RewriteResult<T> {
	let rewritten = 0;
	const unresolved: string[] = [];
	const isLegacy = (url: string) => new RegExp(options.legacyUrl.source, "i").test(url);

	const rewriteString = (text: string): string =>
		text.replace(new RegExp(options.legacyUrl.source, "gi"), (url) => {
			const media = options.resolve({ url: absolute(url) });
			if (!media.local) {
				unresolved.push(url);
				return url;
			}
			rewritten++;
			return media.url;
		});

	const rewriteAsset = (asset: Record<string, unknown>): Record<string, unknown> => {
		const ref = typeof asset._ref === "string" ? asset._ref : "";
		const url = typeof asset.url === "string" ? asset.url : /^(https?:)?\/\//.test(ref) ? ref : "";
		// Imported Gutenberg images keep the WordPress attachment ID as their _ref
		const attachmentId = /^\d+$/.test(ref) ? Number(ref) : undefined;
		if (attachmentId === undefined && !(url && isLegacy(url))) return walk(asset) as Record<string, unknown>;
		const media = options.resolve({ attachmentId, url: absolute(url) });
		if (!media.local) {
			if (url && isLegacy(url)) unresolved.push(url);
			return asset;
		}
		rewritten++;
		return { ...asset, _ref: media.mediaId, url: media.url };
	};

	const walk = (node: unknown): unknown => {
		if (typeof node === "string") return rewriteString(node);
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === "object") {
			const out: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(node)) {
				out[key] =
					key === "asset" && child && typeof child === "object" && !Array.isArray(child)
						? rewriteAsset(child as Record<string, unknown>)
						: walk(child);
			}
			return out;
		}
		return node;
	};

	return { value: walk(value) as T, rewritten, unresolved };
}

function absolute(url: string): string {
	return url.startsWith("//") ? `https:${url}` : url;
}
