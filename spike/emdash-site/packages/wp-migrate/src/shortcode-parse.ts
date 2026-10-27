/**
 * WordPress shortcode parsing, ported from `get_shortcode_regex()` and
 * `shortcode_parse_atts()` (wp-includes/shortcodes.php) so we match exactly what
 * WordPress would have rendered, including escaped `[[gallery]]` (left as text).
 */

export interface ShortcodeMatch {
	name: string;
	attrs: Record<string, string>;
	/** Enclosed content for `[x]...[/x]`, otherwise undefined */
	content?: string;
	start: number;
	end: number;
	raw: string;
}

function shortcodePattern(names: string[]): RegExp {
	const alternation = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new RegExp(
		"\\[(\\[?)" + // 1: optional second [ for escaping
			`(${alternation})` + // 2: name
			"(?![\\w-])" +
			"([^\\]\\/]*(?:\\/(?!\\])[^\\]\\/]*)*?)" + // 3: attributes
			"(?:(\\/)\\]" + // 4: self-closing
			"|\\](?:([^\\[]*(?:\\[(?!\\/\\2\\])[^\\[]*)*)(\\[\\/\\2\\]))?)" + // 5: content, 6: closing tag
			"(\\]?)", // 7: optional second ] for escaping
		"g",
	);
}

const ATTR_PATTERN =
	/([\w-]+)\s*=\s*"([^"]*)"(?:\s|$)|([\w-]+)\s*=\s*'([^']*)'(?:\s|$)|([\w-]+)\s*=\s*([^\s'"]+)(?:\s|$)|"([^"]*)"(?:\s|$)|'([^']*)'(?:\s|$)|(\S+)(?:\s|$)/g;

/** Named attributes are lower-cased like WordPress; positional values get keys "0", "1", ... */
export function parseAttrs(text: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	let position = 0;
	const normalised = text.replace(/[ ​]/g, " ");
	for (const m of normalised.matchAll(ATTR_PATTERN)) {
		if (m[1] !== undefined) attrs[m[1].toLowerCase()] = m[2];
		else if (m[3] !== undefined) attrs[m[3].toLowerCase()] = m[4];
		else if (m[5] !== undefined) attrs[m[5].toLowerCase()] = m[6];
		else attrs[String(position++)] = m[7] ?? m[8] ?? m[9];
	}
	return attrs;
}

export function findShortcodes(text: string, names: string[]): ShortcodeMatch[] {
	const matches: ShortcodeMatch[] = [];
	for (const m of text.matchAll(shortcodePattern(names))) {
		if (m[1] === "[" && m[7] === "]") continue; // [[escaped]] renders literally in WordPress
		// The optional escape brackets are not part of a real shortcode
		const start = m.index + m[1].length;
		const end = m.index + m[0].length - m[7].length;
		matches.push({
			name: m[2],
			attrs: parseAttrs(m[3]),
			content: m[6] ? m[5] : undefined,
			start,
			end,
			raw: text.slice(start, end),
		});
	}
	return matches;
}
