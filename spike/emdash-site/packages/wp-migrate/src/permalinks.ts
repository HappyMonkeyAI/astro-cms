/**
 * Old WordPress permalinks, read from each item's `<link>` in the export. This is the
 * URL WordPress actually served (date-based post paths, nested page paths such as
 * `/parent/child/`), so it's the source for redirects and internal-link rewriting.
 */

import { decodeSlug } from "./slugs.ts";
import { getField, isContentItem, readItems } from "./wxr.ts";

export interface Permalink {
	wpId: number;
	postType: string;
	/** Decoded, as EmDash stores it after the slug pass */
	slug: string;
	status: string;
	/** Decoded path of the old URL, e.g. `/2008/09/03/template-sticky/`; undefined for `?p=123` links */
	path?: string;
	link: string;
}

export function readPermalinks(xml: string): Permalink[] {
	return readItems(xml)
		.filter(({ raw }) => isContentItem(raw))
		.map(({ raw }) => {
			const link = getField(raw, "link");
			let path: string | undefined;
			try {
				const url = new URL(link);
				// Plain permalinks (?p=123, ?page_id=7) can't be matched by path-based redirects.
				// Collapse `//` (seen in real exports), which EmDash would read as a host.
				if (!url.search) path = decodeSlug(url.pathname).replace(/\/{2,}/g, "/");
			} catch {
				// no usable link
			}
			return {
				wpId: Number(getField(raw, "wp:post_id")),
				postType: getField(raw, "wp:post_type"),
				slug: decodeSlug(getField(raw, "wp:post_name")),
				status: getField(raw, "wp:status"),
				path,
				link,
			};
		});
}
