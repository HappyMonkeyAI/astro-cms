/**
 * Pass: protected content (SPEC §5.2, spike F13).
 *
 * EmDash's importer has no notion of WordPress post passwords or private posts, so
 * both arrive published and readable by anyone. Before import we rewrite their status
 * to `draft`; an editor decides what to do with them after migration. Nothing that
 * WordPress kept from the public is ever published, even briefly.
 */

import { getField, isContentItem, readItems, replaceItems, setField } from "./wxr.ts";

export type ProtectionReason = "password" | "private";

export interface ProtectedItem {
	wpId: number;
	type: string;
	slug: string;
	title: string;
	reason: ProtectionReason;
	/** WordPress status before the transform */
	originalStatus: string;
}

/** Statuses that would make an item visible on the new site, now or when scheduled. */
const EXPOSING_STATUSES = new Set(["publish", "future", "private"]);

export function findProtected(xml: string): ProtectedItem[] {
	return readItems(xml).flatMap(({ raw }) => {
		const item = describe(raw);
		return item ? [item] : [];
	});
}

export function protectContent(xml: string): { xml: string; protected: ProtectedItem[] } {
	const items = readItems(xml);
	const replacements = new Map<number, string>();
	const found: ProtectedItem[] = [];
	items.forEach(({ raw }, index) => {
		const item = describe(raw);
		if (!item) return;
		found.push(item);
		if (EXPOSING_STATUSES.has(item.originalStatus)) replacements.set(index, setField(raw, "wp:status", "draft"));
	});
	return { xml: replaceItems(xml, items, replacements), protected: found };
}

function describe(raw: string): ProtectedItem | undefined {
	if (!isContentItem(raw)) return undefined;
	const status = getField(raw, "wp:status");
	const reason: ProtectionReason | undefined = getField(raw, "wp:post_password")
		? "password"
		: status === "private"
			? "private"
			: undefined;
	if (!reason) return undefined;
	return {
		wpId: Number(getField(raw, "wp:post_id")),
		type: getField(raw, "wp:post_type"),
		slug: getField(raw, "wp:post_name"),
		title: getField(raw, "title"),
		reason,
		originalStatus: status,
	};
}
