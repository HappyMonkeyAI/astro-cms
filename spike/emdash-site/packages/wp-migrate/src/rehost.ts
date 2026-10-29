/**
 * Pre-import pass: rehost. Spike F27 (pilot).
 *
 * An export taken from a staging copy after a search-replace (live URL → `http://localhost:8080`)
 * names a local host everywhere. EmDash can't download media from it (the SSRF guard refuses
 * non-public hosts), and every link to it is a go-live leftover. `rehostExport` puts the live
 * site's URL back before anything else runs: plain URLs, JSON-escaped ones (`http:\/\/…`, as
 * page builders store them) and PHP-serialized meta values, whose string lengths it rewrites.
 */

import { getField } from "./wxr.ts";

export interface Rehosted {
	from: string;
	to: string;
	replacements: number;
}

/** The export's own site URL (`wp:base_blog_url`, else the channel link), without a trailing slash. */
export function exportSiteUrl(xml: string): string {
	const channel = xml.slice(0, xml.indexOf("<item>") === -1 ? xml.length : xml.indexOf("<item>"));
	return (getField(channel, "wp:base_blog_url") || getField(channel, "link")).replace(/\/+$/, "");
}

/** Hosts nobody outside the machine or LAN can reach: loopback, private ranges and local-only names. */
export function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || /\.(localhost|local|test|internal|lan|home\.arpa)$/.test(host)) return true;
	if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]/.test(host) || host.startsWith("fe80");
	const ipv4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
	if (ipv4) {
		const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
		return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
	}
	// A bare name such as a Docker service ("wordpress") only resolves locally
	return !host.includes(".");
}

/** Checks and normalises `--production-url`; throws with a usable message. */
export function parseProductionUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`--production-url must be a full URL such as https://example.com (got "${value}")`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("--production-url must start with https:// or http://");
	if (isPrivateHost(url.hostname)) throw new Error(`--production-url must be the live site's public URL, not ${url.hostname}`);
	return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export function rehostExport(xml: string, productionUrl: string): { xml: string; rehosted: Rehosted } {
	const from = exportSiteUrl(xml);
	const to = parseProductionUrl(productionUrl);
	if (!from || from === to) return { xml, rehosted: { from, to, replacements: 0 } };
	const fromUrl = new URL(from);
	const hostAndPath = `${fromUrl.host}${fromUrl.pathname}`.replace(/\/+$/, "");
	// Either scheme or none, either slash style; not a longer host/port/path (localhost:80 ≠ localhost:8080)
	const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const forms = [
		{ slash: "/", pattern: new RegExp(`(?:https?:)?//${escaped(hostAndPath)}(?![\\w.:-])`, "gi") },
		{ slash: "\\/", pattern: new RegExp(`(?:https?:)?\\\\/\\\\/${escaped(hostAndPath.replace(/\//g, "\\/"))}(?![\\w.:-])`, "gi") },
	];
	let replacements = 0;
	const replaceAll = (text: string) =>
		forms.reduce(
			(out, { slash, pattern }) =>
				out.replace(pattern, () => {
					replacements++;
					return to.replace(/\//g, slash);
				}),
			text,
		);

	// Serialized meta values are set aside (their lengths must change with the text), the
	// rest is edited as plain text, then they go back in
	const serialized: string[] = [];
	const plain = xml.replace(/(<wp:meta_value>\s*<!\[CDATA\[)([aOs]:\d+:[\s\S]*?)(\]\]>\s*<\/wp:meta_value>)/g, (_, open, value: string, close) => {
		serialized.push(open + (rewriteSerialized(value, replaceAll) ?? replaceAll(value)) + close);
		return `\u0000${serialized.length - 1}\u0000`;
	});
	const out = replaceAll(plain).replace(/\u0000(\d+)\u0000/g, (_, n) => serialized[Number(n)]);
	return { xml: out, rehosted: { from, to, replacements } };
}

/**
 * Applies `edit` to every string in a PHP-serialized value and fixes its byte length.
 * Returns undefined when the value isn't valid serialized data (it's then edited as plain text).
 */
export function rewriteSerialized(value: string, edit: (s: string) => string): string | undefined {
	const bytes = Buffer.from(value, "utf8");
	let out = "";
	let i = 0;
	let copyFrom = 0;
	while (i < bytes.length) {
		// s:<len>:"<len bytes>"; — only at a token start, which strings are skipped over to guarantee
		if (bytes[i] === 0x73 && bytes[i + 1] === 0x3a && (i === 0 || [0x3b, 0x7b, 0x7d].includes(bytes[i - 1]))) {
			const header = bytes.subarray(i, i + 24).toString("latin1").match(/^s:(\d+):"/);
			if (!header) return undefined;
			const start = i + header[0].length;
			const end = start + Number(header[1]);
			if (end + 2 > bytes.length || bytes[end] !== 0x22 || bytes[end + 1] !== 0x3b) return undefined;
			const edited = edit(bytes.subarray(start, end).toString("utf8"));
			out += bytes.subarray(copyFrom, i).toString("utf8") + `s:${Buffer.byteLength(edited)}:"${edited}";`;
			i = copyFrom = end + 2;
			continue;
		}
		i++;
	}
	return out + bytes.subarray(copyFrom).toString("utf8");
}
