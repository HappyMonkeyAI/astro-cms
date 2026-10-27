/**
 * Pass: shortcodes, part 1 of 2 (before import). SPEC §5.2, spike F13.
 *
 * EmDash's importer leaves shortcodes as raw text and splits `[caption]` across
 * three blocks. Rewriting them to block markup doesn't work either: in block mode
 * the converter turns surrounding classic HTML into raw `htmlBlock`s. So we replace
 * each supported shortcode with a plain-text marker (`{{wpm:<postId>:<n>}}`), which
 * survives both conversion paths unchanged, and record what it stood for in a
 * sidecar. Part 2 (`fix-shortcodes.ts`) swaps markers for real blocks after import,
 * once media has its new IDs.
 */

import { findShortcodes, type ShortcodeMatch } from "./shortcode-parse.ts";
import { getField, isContentItem, readItems, replaceItems, setField } from "./wxr.ts";

export const SUPPORTED_SHORTCODES = ["caption", "wp_caption", "gallery", "audio", "video", "embed"];
export const MARKER_PATTERN = /\{\{wpm:\d+:\d+\}\}/g;

export interface MediaRef {
	attachmentId?: number;
	url: string;
}

export type ShortcodeData =
	| { kind: "caption"; image: MediaRef & { alt?: string }; caption?: string; align?: "left" | "center" | "right"; link?: string }
	| { kind: "gallery"; images: (MediaRef & { alt?: string })[]; columns: number }
	| { kind: "audio"; media: MediaRef }
	| { kind: "video"; media: MediaRef; poster?: string }
	| { kind: "embed"; url: string };

export interface ShortcodeEntry {
	marker: string;
	wpPostId: number;
	postType: string;
	slug: string;
	/** Original shortcode text, for the report */
	raw: string;
	data?: ShortcodeData;
	/** Why the shortcode could not be converted; it is left in the content untouched */
	problem?: string;
}

interface Attachment {
	id: number;
	url: string;
	parent: number;
	menuOrder: number;
	title: string;
}

const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i;

export function extractShortcodes(xml: string): { xml: string; entries: ShortcodeEntry[] } {
	const items = readItems(xml);
	const attachments = new Map<number, Attachment>();
	for (const { raw } of items) {
		if (getField(raw, "wp:post_type") !== "attachment") continue;
		const id = Number(getField(raw, "wp:post_id"));
		attachments.set(id, {
			id,
			url: getField(raw, "wp:attachment_url"),
			parent: Number(getField(raw, "wp:post_parent")),
			menuOrder: Number(getField(raw, "wp:menu_order")),
			title: getField(raw, "title"),
		});
	}

	const entries: ShortcodeEntry[] = [];
	const replacements = new Map<number, string>();
	items.forEach(({ raw }, index) => {
		if (!isContentItem(raw)) return;
		const content = getField(raw, "content:encoded");
		const matches = findShortcodes(content, SUPPORTED_SHORTCODES);
		if (matches.length === 0) return;
		const post = {
			wpPostId: Number(getField(raw, "wp:post_id")),
			postType: getField(raw, "wp:post_type"),
			slug: getField(raw, "wp:post_name"),
		};
		let rewritten = "";
		let cursor = 0;
		matches.forEach((match, n) => {
			const marker = `{{wpm:${post.wpPostId}:${n}}}`;
			const result = describe(match, post.wpPostId, attachments);
			entries.push({ marker, ...post, raw: match.raw, ...result });
			rewritten += content.slice(cursor, match.start) + (result.data ? marker : match.raw);
			cursor = match.end;
		});
		rewritten += content.slice(cursor);
		if (rewritten !== content) replacements.set(index, setField(raw, "content:encoded", rewritten));
	});
	return { xml: replaceItems(xml, items, replacements), entries };
}

function describe(
	match: ShortcodeMatch,
	postId: number,
	attachments: Map<number, Attachment>,
): { data?: ShortcodeData; problem?: string } {
	const { attrs } = match;
	switch (match.name) {
		case "caption":
		case "wp_caption": {
			const html = match.content ?? "";
			const img = html.match(/<img\b[^>]*>/i)?.[0];
			const src = img && attr(img, "src");
			if (!img || !src) return { problem: "caption without an <img>" };
			const fromClass = img.match(/\bwp-image-(\d+)\b/)?.[1];
			const fromId = attrs.id?.match(/^attachment_(\d+)$/)?.[1];
			const id = Number(fromClass ?? fromId) || undefined;
			const link = html.match(/<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>/i)?.[0];
			const caption = attrs.caption ?? htmlToText(html.replace(link ?? img, ""));
			const align = ({ alignleft: "left", aligncenter: "center", alignright: "right" } as const)[
				attrs.align as "alignleft" | "aligncenter" | "alignright"
			];
			return {
				data: {
					kind: "caption",
					image: { attachmentId: id, url: decodeEntities(src), alt: decodeEntities(attr(img, "alt") ?? "") || undefined },
					caption: caption || undefined,
					align,
					link: link ? decodeEntities(attr(link, "href") ?? "") || undefined : undefined,
				},
			};
		}
		case "gallery": {
			const listed = (attrs.ids ?? attrs.include ?? "")
				.split(",")
				.map((s) => Number(s.trim()))
				.filter((n) => n > 0);
			const excluded = new Set((attrs.exclude ?? "").split(",").map((s) => Number(s.trim())));
			// Without ids WordPress shows the post's attached images, by menu_order then ID
			const ids = listed.length
				? listed
				: [...attachments.values()]
						.filter((a) => a.parent === postId && IMAGE_EXTENSION.test(a.url) && !excluded.has(a.id))
						.sort((a, b) => a.menuOrder - b.menuOrder || a.id - b.id)
						.map((a) => a.id);
			if (attrs.order?.toUpperCase() === "DESC") ids.reverse();
			const images = ids.flatMap((id) => {
				const a = attachments.get(id);
				return a ? [{ attachmentId: id, url: a.url, alt: a.title || undefined }] : [];
			});
			if (images.length === 0) return { problem: "gallery with no images in the export" };
			return { data: { kind: "gallery", images, columns: Number(attrs.columns) || 3 } };
		}
		case "audio":
		case "video": {
			const keys =
				match.name === "audio" ? ["src", "mp3", "m4a", "ogg", "wav", "0"] : ["src", "mp4", "m4v", "webm", "ogv", "flv", "0"];
			const url = keys.map((k) => attrs[k]).find(Boolean) ?? firstUrl(match.content);
			if (!url) return { problem: `${match.name} without a source URL` };
			const media = { attachmentId: findAttachmentByUrl(attachments, url), url };
			return match.name === "audio"
				? { data: { kind: "audio", media } }
				: { data: { kind: "video", media, poster: attrs.poster } };
		}
		case "embed": {
			const url = firstUrl(match.content) ?? attrs.src ?? attrs.url;
			return url ? { data: { kind: "embed", url } } : { problem: "embed without a URL" };
		}
	}
	return { problem: `unsupported shortcode ${match.name}` };
}

function attr(tag: string, name: string): string | undefined {
	return tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v !== undefined);
}

function firstUrl(text?: string): string | undefined {
	return text?.match(/https?:\/\/[^\s"'<>\]]+/)?.[0];
}

function findAttachmentByUrl(attachments: Map<number, Attachment>, url: string): number | undefined {
	for (const a of attachments.values()) if (a.url === url) return a.id;
	return undefined;
}

function htmlToText(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&#039;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}
