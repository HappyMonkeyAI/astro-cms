/**
 * WordPress post type → EmDash collection.
 *
 * The import step records the collection EmDash actually used for each post type (its
 * analysis's `suggestedCollection`), and every later pass must use the same names. Without
 * that record, mirror EmDash's own default table (emdash 1.3.1 `mapPostTypeToCollection`): a
 * few known types get a plural name, and every other type keeps its post type name, e.g.
 * `elementor_library` stays `elementor_library` (not `elementor_librarys`).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const EMDASH_COLLECTIONS: Readonly<Record<string, string>> = {
	post: "posts",
	page: "pages",
	attachment: "media",
	product: "products",
	portfolio: "portfolio",
	testimonial: "testimonials",
	team: "team",
	event: "events",
	faq: "faqs",
};

export function toCollection(postType: string, known: Record<string, string> = {}): string {
	return known[postType] ?? EMDASH_COLLECTIONS[postType] ?? postType;
}

/** Post type → collection from an import analysis (`1-analysis.json`) */
export function collectionsFromAnalysis(analysis: { postTypes?: { name: string; suggestedCollection?: string }[] }): Record<string, string> {
	return Object.fromEntries((analysis.postTypes ?? []).filter((p) => p.suggestedCollection).map((p) => [p.name, p.suggestedCollection!]));
}

/** The collections recorded by `migrate`'s import step in `<outDir>/import/`, or {} when there was none */
export async function readImportCollections(outDir: string): Promise<Record<string, string>> {
	try {
		return collectionsFromAnalysis(JSON.parse(await readFile(join(outDir, "import", "1-analysis.json"), "utf8")));
	} catch {
		return {};
	}
}
