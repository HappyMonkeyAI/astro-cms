/**
 * The hosts the WordPress site served content and media from: the blog URL, the
 * channel link and every attachment host (often a CDN such as `example.files.wordpress.com`).
 * Any URL on these hosts left in migrated content still depends on the old site.
 */

import { getField, readItems } from "./wxr.ts";

export function findLegacyHosts(xml: string): string[] {
	const channel = xml.slice(0, xml.indexOf("<item>") === -1 ? xml.length : xml.indexOf("<item>"));
	// Not wp:base_site_url: on multisite and WordPress.com that is the network root
	// (e.g. wordpress.com), which would flag unrelated links on other sites
	const urls = [
		getField(channel, "wp:base_blog_url"),
		getField(channel, "link"),
		...readItems(xml)
			.filter(({ raw }) => getField(raw, "wp:post_type") === "attachment")
			.map(({ raw }) => getField(raw, "wp:attachment_url")),
	];
	const hosts = new Set<string>();
	for (const url of urls) {
		try {
			if (url) hosts.add(new URL(url).hostname.toLowerCase());
		} catch {
			// not a URL; ignore
		}
	}
	return [...hosts].sort();
}

/** Matches absolute or protocol-relative URLs on any of the hosts. */
export function legacyUrlPattern(hosts: string[]): RegExp {
	if (hosts.length === 0) return /(?!)/g;
	const alternation = hosts.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new RegExp(`(?:https?:)?\\/\\/(?:${alternation})(?![\\w.-])[^\\s"'<>()\\[\\]]*`, "gi");
}
