/**
 * Pass: non-ASCII slugs (before import). Spike F21.
 *
 * WordPress stores non-ASCII slugs percent-encoded (`%ce%b5%cf%80…`). EmDash's importer
 * keeps that text verbatim as the slug, but Astro decodes the request path before the
 * lookup, so the entry is unreachable at any URL. EmDash serves Unicode slugs fine, so we
 * decode post, category, tag and term slugs in the export before import.
 */

export interface DecodedSlug {
	field: string;
	from: string;
	to: string;
}

const SLUG_ELEMENT = /<(wp:post_name|wp:category_nicename|wp:tag_slug|wp:term_slug)>(<!\[CDATA\[)?([^<\]]*?)(\]\]>)?<\/\1>/g;
const NICENAME_ATTR = /(<category\b[^>]*\bnicename=")([^"]*)(")/g;
const PERCENT_ESCAPE = /%[0-9a-f]{2}/i;

export function decodeSlugs(xml: string): { xml: string; decoded: DecodedSlug[] } {
	const decoded: DecodedSlug[] = [];
	const seen = new Set<string>();
	const record = (field: string, from: string, to: string) => {
		const key = `${field}:${from}`;
		if (!seen.has(key)) decoded.push({ field, from, to });
		seen.add(key);
	};
	let out = xml.replace(SLUG_ELEMENT, (whole, name: string, open = "", value: string, close = "") => {
		const to = decodeSlug(value);
		if (to === value) return whole;
		record(name, value, to);
		// Decoded text may contain characters that need escaping outside CDATA
		return `<${name}>${open}${open ? to : escapeXml(to)}${close}</${name}>`;
	});
	out = out.replace(NICENAME_ATTR, (whole, before: string, value: string, after: string) => {
		const to = decodeSlug(value);
		if (to === value) return whole;
		record("category@nicename", value, to);
		return `${before}${escapeXml(to).replace(/"/g, "&quot;")}${after}`;
	});
	return { xml: out, decoded };
}

/** Decode a percent-encoded slug; returns the input unchanged if it isn't encoded or isn't valid UTF-8. */
export function decodeSlug(slug: string): string {
	if (!PERCENT_ESCAPE.test(slug)) return slug;
	try {
		return decodeURIComponent(slug);
	} catch {
		return slug;
	}
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
