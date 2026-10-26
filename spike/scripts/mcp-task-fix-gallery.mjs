#!/usr/bin/env node
/**
 * MCP task 1: replace raw [gallery] shortcodes in an imported post with real
 * gallery blocks built from the imported media. Every read and write goes through
 * EmDash's MCP tools (via mcp.mjs). The WXR file supplies the attachment → post
 * relationship, which EmDash doesn't keep.
 *
 * Usage: node spike/scripts/mcp-task-fix-gallery.mjs <wxr> <post-slug> [--publish]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [wxrPath, slug] = process.argv.slice(2);
const mcp = (tool, args) =>
	JSON.parse(
		execFileSync("node", [join(here, "mcp.mjs"), "call", tool, "-"], { input: JSON.stringify(args), encoding: "utf8" }),
	);

// Attachments whose post_parent is this post, from the WXR source
const items = readFileSync(wxrPath, "utf8").split("<item>").slice(1);
const field = (item, name) => item.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([^<\\]]*)`))?.[1] ?? "";
const post = items.find((i) => field(i, "wp:post_name") === slug);
const wpId = field(post, "wp:post_id");
const attached = items
	.filter((i) => field(i, "wp:post_type") === "attachment" && field(i, "wp:post_parent") === wpId)
	.map((i) => ({
		file: field(i, "wp:attachment_url").split("/").pop(),
		title: field(i, "title"),
		order: Number(field(i, "wp:menu_order")),
	}))
	.sort((a, b) => a.order - b.order);

// Media library, via MCP
const media = [];
let cursor;
do {
	const page = mcp("media_list", { limit: 100, ...(cursor ? { cursor } : {}) });
	media.push(...page.items);
	cursor = page.nextCursor;
} while (cursor);
const byFile = new Map(media.map((m) => [m.filename, m]));

let keyCounter = 0;
const key = () => `fix-${Date.now().toString(36)}-${keyCounter++}`;
const images = attached
	.filter((a) => byFile.has(a.file))
	.map((a) => {
		const m = byFile.get(a.file);
		return {
			_type: "image",
			_key: key(),
			asset: { _type: "reference", _ref: m.id, url: `/_emdash/api/media/file/${m.storageKey}` },
			alt: m.alt ?? a.title,
			width: m.width ?? undefined,
			height: m.height ?? undefined,
		};
	});

// Read → transform → update (with _rev), via MCP
const { item, _rev } = mcp("content_get", { collection: "posts", id: slug });
const GALLERY = /^\s*\[gallery(?:\s+columns="(\d+)")?\s*\]\s*/;
let replaced = 0;
const content = item.data.content.flatMap((block) => {
	const text = block._type === "block" ? (block.children ?? []).map((c) => c.text).join("") : "";
	const match = text.match(GALLERY);
	if (!match) return [block];
	replaced++;
	const gallery = {
		_type: "gallery",
		_key: key(),
		images: images.map((image) => ({ ...image, _key: key() })),
		...(match[1] ? { columns: Number(match[1]) } : {}),
	};
	const rest = text.slice(match[0].length).trim();
	return rest
		? [gallery, { ...block, _key: key(), children: [{ _type: "span", _key: key(), text: rest, marks: [] }] }]
		: [gallery];
});

console.log(`post ${slug} (wp ${wpId}): ${attached.length} attachments, ${images.length} matched in media library, ${replaced} shortcodes replaced`);
const updated = mcp("content_update", {
	collection: "posts",
	id: item.id,
	_rev,
	data: { content },
	...(process.argv.includes("--publish") ? { status: "published" } : {}),
});
console.log(`update ok: status=${updated.item?.status} draftRevision=${updated.item?.draftRevisionId} liveRevision=${updated.item?.liveRevisionId}`);
