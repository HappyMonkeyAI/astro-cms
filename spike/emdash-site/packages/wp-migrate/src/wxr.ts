/**
 * Minimal WXR (WordPress eXtended RSS) reader/editor.
 *
 * Works on the raw text so a transformed export is byte-identical to the original
 * except for the fields we change. WordPress writes some fields as CDATA and some
 * plain (both appear in the theme unit test data), so reads unwrap either form and
 * writes keep whichever form the field already used.
 */

export interface WxrItem {
	/** Offset of `<item>` in the source text */
	start: number;
	/** Offset just past `</item>` */
	end: number;
	raw: string;
}

const ITEM_PATTERN = /<item>[\s\S]*?<\/item>/g;
const CDATA_PATTERN = /^<!\[CDATA\[([\s\S]*)\]\]>$/;

export function readItems(xml: string): WxrItem[] {
	return [...xml.matchAll(ITEM_PATTERN)].map((m) => ({ start: m.index, end: m.index + m[0].length, raw: m[0] }));
}

function fieldPattern(name: string): RegExp {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`<${escaped}>([\\s\\S]*?)</${escaped}>`);
}

/** First occurrence of `<name>` in the item, unwrapped and trimmed; "" when absent. */
export function getField(raw: string, name: string): string {
	const value = raw.match(fieldPattern(name))?.[1]?.trim() ?? "";
	return value.match(CDATA_PATTERN)?.[1] ?? value;
}

/** Replace the first `<name>` value, keeping CDATA if the original used it. Throws if the field is missing. */
export function setField(raw: string, name: string, value: string): string {
	const pattern = fieldPattern(name);
	const match = raw.match(pattern);
	if (!match) throw new Error(`WXR item has no <${name}> field`);
	const inner = CDATA_PATTERN.test(match[1].trim()) ? `<![CDATA[${value}]]>` : escapeXml(value);
	return raw.replace(pattern, `<${name}>${inner}</${name}>`);
}

/** Rebuild the document with some items replaced (by index into `items`). */
export function replaceItems(xml: string, items: WxrItem[], replacements: Map<number, string>): string {
	let out = "";
	let cursor = 0;
	items.forEach((item, index) => {
		const replacement = replacements.get(index);
		if (replacement === undefined) return;
		out += xml.slice(cursor, item.start) + replacement;
		cursor = item.end;
	});
	return out + xml.slice(cursor);
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** WordPress post types that hold site content (not attachments, menu items or internals). */
export function isContentItem(raw: string): boolean {
	const type = getField(raw, "wp:post_type");
	return type !== "" && type !== "attachment" && type !== "nav_menu_item" && !type.startsWith("wp_");
}
