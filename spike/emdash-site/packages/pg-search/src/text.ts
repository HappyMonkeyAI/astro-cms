/**
 * Pure helpers (no database): turning visitor input into a safe tsquery, field weights, and
 * snippet sanitising. Unit-tested on plain Node.
 */

/** Postgres text search configurations we accept (identifier-safe, passed as a literal). */
const CONFIG_RE = /^[a-z_]{2,32}$/;

/** The text search configuration: `PG_SEARCH_CONFIG` (e.g. "english", "simple", "german"), default "english". */
export function searchConfig(env: Record<string, string | undefined> = globalThis.process?.env ?? {}): string {
	const value = env.PG_SEARCH_CONFIG?.trim().toLowerCase();
	return value && CONFIG_RE.test(value) ? value : "english";
}

// Letters and digits in any script, plus apostrophes inside words; everything else separates terms.
const TERM_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const PHRASE_RE = /"([^"]*)"/g;
const MAX_TERMS = 12;

function terms(text: string): string[] {
	return (text.match(TERM_RE) ?? []).map((t) => t.replace(/['’]/g, "")).filter(Boolean);
}

/**
 * Build a `to_tsquery` string from visitor input. Never passes user syntax through: every term is
 * reduced to letters and digits, so the only operators are the ones we add.
 *
 * - `hel wor`        → `hel:* & wor:*` (every term must match, as a prefix, like EmDash's FTS5 path)
 * - `"exact phrase"` → `exact <-> phrase`
 *
 * Returns "" when nothing searchable is left.
 */
export function toTsQuery(input: unknown): string {
	if (typeof input !== "string") return "";
	const parts: string[] = [];
	let rest = input;
	for (const match of input.matchAll(PHRASE_RE)) {
		const words = terms(match[1]);
		if (words.length > 1) parts.push(`(${words.join(" <-> ")})`);
		else if (words.length === 1) parts.push(`${words[0]}:*`);
		rest = rest.replace(match[0], " ");
	}
	for (const word of terms(rest.replace(/"/g, " "))) parts.push(`${word}:*`);
	return parts.slice(0, MAX_TERMS).join(" & ");
}

/** Map EmDash's numeric field weights (higher = more important) to Postgres weight classes A–D. */
export function weightClass(weight: number | undefined, isTitle: boolean): "A" | "B" | "C" | "D" {
	if (weight === undefined) return isTitle ? "A" : "C";
	if (weight >= 3) return "A";
	if (weight >= 2) return "B";
	if (weight > 0) return "C";
	return "D";
}

/** Markers ts_headline wraps matches in; control characters can't come from stored text we escape. */
export const START_SEL = "\u0002";
export const STOP_SEL = "\u0003";

/**
 * Same contract as EmDash's FTS5 path: HTML metacharacters escaped, matched terms in literal
 * <mark> tags, and nothing else.
 */
export function sanitizeSnippet(snippet: string | null | undefined): string | undefined {
	if (snippet == null) return undefined;
	const escaped = snippet
		.replace(/[\u0000\u0001\u0004-\u0008\u000b\u000c\u000e-\u001f]/g, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replaceAll(START_SEL, "<mark>")
		.replaceAll(STOP_SEL, "</mark>")
		.trim();
	return escaped || undefined;
}
