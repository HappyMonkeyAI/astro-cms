/**
 * Replace `{{wpm:…}}` markers inside stored Portable Text with real blocks.
 *
 * A marker can sit anywhere in a text block (classic posts put shortcodes mid-paragraph)
 * or be the whole of an `htmlBlock` (Gutenberg `core/shortcode`). Text blocks are split
 * at the marker: the text before keeps the original `_key`, the text after gets a new one,
 * and fragments that are only whitespace are dropped.
 */

import { MARKER_PATTERN } from "./shortcodes.ts";

export interface PtSpan {
	_type: string;
	_key: string;
	text?: string;
	marks?: string[];
	[k: string]: unknown;
}

export interface PtBlock {
	_type: string;
	_key: string;
	children?: PtSpan[];
	markDefs?: { _key: string; [k: string]: unknown }[];
	html?: string;
	[k: string]: unknown;
}

export interface MarkerResult {
	blocks: PtBlock[];
	replaced: string[];
	/** Markers found but not replaceable (unknown, or spread across spans / mixed into HTML) */
	stuck: string[];
}

export function replaceMarkers(
	blocks: PtBlock[],
	build: (marker: string) => PtBlock[] | undefined,
	newKey: () => string,
): MarkerResult {
	const out: PtBlock[] = [];
	const replaced: string[] = [];
	const stuck: string[] = [];

	for (const block of blocks) {
		if (block._type === "htmlBlock" && typeof block.html === "string") {
			const markers = block.html.match(MARKER_PATTERN) ?? [];
			const only = markers.length === 1 && block.html.trim() === markers[0];
			const replacement = only ? build(markers[0]) : undefined;
			if (replacement) {
				out.push(...replacement);
				replaced.push(markers[0]);
			} else {
				out.push(block);
				stuck.push(...markers);
			}
			continue;
		}
		if (block._type !== "block" || !Array.isArray(block.children)) {
			out.push(block);
			continue;
		}
		out.push(...splitBlock(block, build, newKey, replaced, stuck));
	}
	return { blocks: out, replaced, stuck };
}

function splitBlock(
	block: PtBlock,
	build: (marker: string) => PtBlock[] | undefined,
	newKey: () => string,
	replaced: string[],
	stuck: string[],
): PtBlock[] {
	const joined = block.children!.map((c) => c.text ?? "").join("");
	const total = joined.match(MARKER_PATTERN)?.length ?? 0;
	if (total === 0) return [block];

	const out: PtBlock[] = [];
	let current: PtSpan[] = [];
	let first = true;
	const flush = () => {
		const fragment = finishFragment(block, current, first ? block._key : newKey());
		if (fragment) {
			out.push(fragment);
			first = false;
		}
		current = [];
	};

	let inSpans = 0;
	for (const span of block.children!) {
		const text = span.text ?? "";
		let cursor = 0;
		// The first piece of a split span keeps its key; later pieces get new ones
		let pieces = 0;
		const piece = (slice: string) => ({ ...span, _key: pieces++ === 0 ? span._key : newKey(), text: slice });
		for (const m of text.matchAll(MARKER_PATTERN)) {
			inSpans++;
			const replacement = build(m[0]);
			if (!replacement) {
				stuck.push(m[0]);
				continue;
			}
			if (m.index > cursor) current.push(piece(text.slice(cursor, m.index)));
			flush();
			out.push(...replacement);
			replaced.push(m[0]);
			cursor = m.index + m[0].length;
		}
		if (cursor < text.length) current.push(piece(text.slice(cursor)));
	}
	flush();
	// Markers broken across spans (e.g. by formatting) can't be located safely
	if (inSpans < total) stuck.push(...(joined.match(MARKER_PATTERN) ?? []).slice(inSpans));
	return out;
}

function finishFragment(block: PtBlock, spans: PtSpan[], key: string): PtBlock | undefined {
	if (!spans.some((s) => (s.text ?? "").trim())) return undefined;
	const trimmed = spans.map((s) => ({ ...s }));
	trimmed[0].text = (trimmed[0].text ?? "").trimStart();
	trimmed[trimmed.length - 1].text = (trimmed[trimmed.length - 1].text ?? "").trimEnd();
	const used = new Set(trimmed.flatMap((s) => s.marks ?? []));
	const markDefs = block.markDefs?.filter((d) => used.has(d._key));
	return { ...block, _key: key, children: trimmed.filter((s) => s.text !== ""), markDefs: markDefs?.length ? markDefs : undefined };
}
