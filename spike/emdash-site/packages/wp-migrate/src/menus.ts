/**
 * Pass: menus. SPEC §5.2, spike F13 (the importer found 0 of the export's menus).
 *
 * `readMenus` (before import) reads `nav_menu_item` posts into a portable spec: label
 * (WordPress falls back to the target's title), target (entry, term or URL) and parent.
 * `planMenuItems` (after import) resolves targets to EmDash IDs and flattens the tree
 * into `menu_set_items` order. Items whose target isn't published are dropped and their
 * children move up one level, as WordPress hides them too.
 */

import { decodeSlug } from "./slugs.ts";
import { getField, isContentItem, readItems } from "./wxr.ts";

export type MenuTarget =
	| { kind: "entry"; postType: string; slug: string }
	| { kind: "term"; taxonomy: string; slug: string }
	| { kind: "custom"; url: string };

export interface MenuItemSpec {
	wpId: number;
	label: string;
	target: MenuTarget;
	parentWpId?: number;
	order: number;
	openInNewTab?: boolean;
	cssClasses?: string;
	titleAttr?: string;
}

export interface MenuSpec {
	slug: string;
	label: string;
	items: MenuItemSpec[];
}

export function readMenus(xml: string): MenuSpec[] {
	const items = readItems(xml);
	const entries = new Map<number, { postType: string; slug: string; title: string }>();
	for (const { raw } of items) {
		if (!isContentItem(raw)) continue;
		entries.set(Number(getField(raw, "wp:post_id")), {
			postType: getField(raw, "wp:post_type"),
			slug: decodeSlug(getField(raw, "wp:post_name")),
			title: getField(raw, "title"),
		});
	}
	const terms = readTerms(xml);

	const menus = new Map<string, MenuSpec>();
	for (const { raw } of items) {
		if (getField(raw, "wp:post_type") !== "nav_menu_item") continue;
		const menu = raw.match(/<category domain="nav_menu" nicename="([^"]*)">(?:<!\[CDATA\[)?([^<\]]*)/);
		if (!menu) continue;
		const meta = readMeta(raw);
		const objectId = Number(meta.get("_menu_item_object_id"));
		const object = meta.get("_menu_item_object") ?? "";
		let target: MenuTarget;
		let fallbackLabel = "";
		switch (meta.get("_menu_item_type")) {
			case "post_type": {
				const entry = entries.get(objectId);
				target = entry ? { kind: "entry", postType: entry.postType, slug: entry.slug } : { kind: "entry", postType: object, slug: "" };
				fallbackLabel = entry?.title ?? "";
				break;
			}
			case "taxonomy": {
				const term = terms.get(objectId);
				target = { kind: "term", taxonomy: object, slug: term?.slug ?? "" };
				fallbackLabel = term?.name ?? "";
				break;
			}
			default:
				target = { kind: "custom", url: meta.get("_menu_item_url") ?? "" };
				fallbackLabel = target.url;
		}
		const parent = Number(meta.get("_menu_item_menu_item_parent"));
		const classes = [...(meta.get("_menu_item_classes") ?? "").matchAll(/s:\d+:"([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
		const slug = decodeSlug(menu[1]);
		const spec = menus.get(slug) ?? { slug, label: menu[2] || slug, items: [] };
		spec.items.push({
			wpId: Number(getField(raw, "wp:post_id")),
			label: getField(raw, "title") || fallbackLabel,
			target,
			parentWpId: parent > 0 ? parent : undefined,
			order: Number(getField(raw, "wp:menu_order")) || 0,
			openInNewTab: meta.get("_menu_item_target") === "_blank" || undefined,
			cssClasses: classes.length ? classes.join(" ") : undefined,
			titleAttr: getField(raw, "excerpt:encoded") || undefined,
		});
		menus.set(slug, spec);
	}
	for (const menu of menus.values()) menu.items.sort((a, b) => a.order - b.order || a.wpId - b.wpId);
	return [...menus.values()];
}

/** Item shape for EmDash's `menu_set_items` MCP tool. */
export interface EmDashMenuItem {
	label: string;
	type: "custom" | "page" | "post" | "taxonomy" | "collection";
	customUrl?: string;
	referenceCollection?: string;
	referenceId?: string;
	titleAttr?: string;
	target?: string;
	cssClasses?: string;
	parentIndex?: number;
}

export interface MenuResolver {
	entry(postType: string, slug: string): { collection: string; id: string } | undefined;
	term(taxonomy: string, slug: string): { taxonomy: string; id: string } | undefined;
	url(url: string): string;
}

export function planMenuItems(menu: MenuSpec, resolve: MenuResolver): { items: EmDashMenuItem[]; dropped: { label: string; reason: string }[] } {
	const items: EmDashMenuItem[] = [];
	const dropped: { label: string; reason: string }[] = [];
	const children = new Map<number | undefined, MenuItemSpec[]>();
	const known = new Set(menu.items.map((i) => i.wpId));
	for (const item of menu.items) {
		// Orphans (parent not in this menu) become top-level, like WordPress
		const parent = item.parentWpId !== undefined && known.has(item.parentWpId) ? item.parentWpId : undefined;
		children.set(parent, [...(children.get(parent) ?? []), item]);
	}

	const emit = (parentWpId: number | undefined, parentIndex: number | undefined, depth: number) => {
		if (depth > 50) return; // guards against cyclic parent data
		for (const item of children.get(parentWpId) ?? []) {
			const base = {
				label: item.label,
				titleAttr: item.titleAttr,
				target: item.openInNewTab ? "_blank" : undefined,
				cssClasses: item.cssClasses,
				parentIndex,
			};
			let resolved: EmDashMenuItem | undefined;
			const t = item.target;
			if (t.kind === "custom") resolved = { ...base, type: "custom", customUrl: resolve.url(t.url) };
			else if (t.kind === "entry") {
				const hit = t.slug ? resolve.entry(t.postType, t.slug) : undefined;
				if (hit) {
					const type = t.postType === "page" || t.postType === "post" ? t.postType : "collection";
					resolved = { ...base, type, referenceCollection: hit.collection, referenceId: hit.id };
				}
			} else {
				const hit = t.slug ? resolve.term(t.taxonomy, t.slug) : undefined;
				if (hit) resolved = { ...base, type: "taxonomy", referenceCollection: hit.taxonomy, referenceId: hit.id };
			}
			if (!resolved) {
				dropped.push({ label: item.label, reason: `${t.kind} target not published on the new site` });
				emit(item.wpId, parentIndex, depth + 1);
				continue;
			}
			items.push(Object.fromEntries(Object.entries(resolved).filter(([, v]) => v !== undefined)) as EmDashMenuItem);
			emit(item.wpId, items.length - 1, depth + 1);
		}
	};
	emit(undefined, undefined, 0);
	return { items, dropped };
}

function readMeta(raw: string): Map<string, string> {
	const meta = new Map<string, string>();
	for (const m of raw.matchAll(/<wp:postmeta>\s*<wp:meta_key>(?:<!\[CDATA\[)?([^<\]]*)(?:\]\]>)?<\/wp:meta_key>\s*<wp:meta_value>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/wp:meta_value>/g)) {
		meta.set(m[1], m[2]);
	}
	return meta;
}

function readTerms(xml: string): Map<number, { slug: string; name: string }> {
	const terms = new Map<number, { slug: string; name: string }>();
	const add = (block: string, slugField: string, nameField: string) => {
		const id = Number(getField(block, "wp:term_id"));
		if (id) terms.set(id, { slug: decodeSlug(getField(block, slugField)), name: getField(block, nameField) });
	};
	for (const m of xml.matchAll(/<wp:category>[\s\S]*?<\/wp:category>/g)) add(m[0], "wp:category_nicename", "wp:cat_name");
	for (const m of xml.matchAll(/<wp:tag>[\s\S]*?<\/wp:tag>/g)) add(m[0], "wp:tag_slug", "wp:tag_name");
	for (const m of xml.matchAll(/<wp:term>[\s\S]*?<\/wp:term>/g)) add(m[0], "wp:term_slug", "wp:term_name");
	return terms;
}
