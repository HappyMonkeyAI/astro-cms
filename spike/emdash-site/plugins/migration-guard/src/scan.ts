/**
 * Pure scanning logic: find WordPress migration leftovers in an entry's field data.
 * No host APIs, so it runs unchanged in the sandbox and in unit tests.
 */

export interface ScanResult {
	/** Shortcode name → occurrences left as literal text, e.g. { gallery: 3 } */
	shortcodes: Record<string, number>;
	/** References to legacy hosts (old WordPress origin, CDN) */
	legacyUrls: number;
	sampleUrls: string[];
}

// WordPress core + common page-builder/form shortcodes. Matching a known list avoids
// flagging ordinary bracketed text such as "[1]" or "[sic]".
const KNOWN_SHORTCODES =
	/\[\/?(gallery|caption|wp_caption|audio|video|embed|playlist|contact-form(?:-7)?|gravityform|vc_[a-z_]+|et_pb_[a-z_]+|fusion_[a-z_]+)\b[^\]]*\]/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/gi;

/** Every string in a nested value (Portable Text spans, html blocks, image asset URLs, …). */
function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
	if (depth > 40) return out;
	if (typeof value === "string") out.push(value);
	else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
	else if (value && typeof value === "object")
		for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out, depth + 1);
	return out;
}

export function normaliseHosts(hosts: readonly string[]): string[] {
	return [...new Set(hosts.map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean))];
}

export function scanData(data: unknown, legacyHosts: readonly string[]): ScanResult {
	const hosts = normaliseHosts(legacyHosts);
	const result: ScanResult = { shortcodes: {}, legacyUrls: 0, sampleUrls: [] };

	for (const text of collectStrings(data)) {
		for (const match of text.matchAll(KNOWN_SHORTCODES)) {
			// Count opening tags only, so [caption]…[/caption] is one leftover
			if (match[0].startsWith("[/")) continue;
			const name = match[1].toLowerCase();
			result.shortcodes[name] = (result.shortcodes[name] ?? 0) + 1;
		}
		if (hosts.length === 0) continue;
		for (const match of text.matchAll(URL_PATTERN)) {
			let host: string;
			try {
				host = new URL(match[0]).hostname.toLowerCase();
			} catch {
				continue;
			}
			if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
				result.legacyUrls++;
				if (result.sampleUrls.length < 3 && !result.sampleUrls.includes(match[0])) result.sampleUrls.push(match[0]);
			}
		}
	}
	return result;
}

export function hasIssues(result: ScanResult): boolean {
	return result.legacyUrls > 0 || Object.keys(result.shortcodes).length > 0;
}

/**
 * True when `next` has no kind of leftover that `live` lacks and no more of any kind.
 * Lets a fix go live on a page that still has an unrelated leftover (e.g. legacy URLs
 * rewritten on a page that keeps a contact-form shortcode), without ever making it worse.
 */
export function isNoWorse(next: ScanResult, live: ScanResult): boolean {
	if (next.legacyUrls > live.legacyUrls) return false;
	return Object.entries(next.shortcodes).every(([name, count]) => count <= (live.shortcodes[name] ?? 0));
}

/** One-line, plain-text summary (publication policy reasons must be ≤ 500 chars). */
export function summarise(result: ScanResult): string {
	const parts = Object.entries(result.shortcodes).map(([name, n]) => `${n}× [${name}]`);
	if (result.legacyUrls) parts.push(`${result.legacyUrls} legacy-host URL${result.legacyUrls === 1 ? "" : "s"}`);
	return parts.join(", ");
}
