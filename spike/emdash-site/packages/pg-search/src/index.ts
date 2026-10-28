/**
 * Postgres full-text search for EmDash (spike finding F2: EmDash's search is SQLite FTS5 only).
 *
 * EmDash's `searchWithDb`, `searchCollection` and `getSuggestions` hand off to these functions on
 * Postgres (scripts/patch-emdash.mjs), so `search()` in templates, `/_emdash/api/search`,
 * `/_emdash/api/search/suggest` and the MCP `search` tool all work unchanged. Results keep EmDash's
 * shapes: the same cursors, scores (higher is better) and `<mark>`-only snippets.
 *
 * There's no index table to keep in sync. Each query builds a weighted tsvector from the
 * collection's searchable fields (Portable Text via jsonpath), so results always reflect the
 * current content. That suits agency-sized sites; add expression indexes if a site outgrows it.
 *
 * Search is per collection, as in EmDash: only collections whose `search_config.enabled` is true
 * are searched, and only fields marked searchable are indexed.
 */

import { type Kysely, PostgresAdapter, type RawBuilder, sql } from "kysely";

import { searchConfig, sanitizeSnippet, START_SEL, STOP_SEL, toTsQuery, weightClass } from "./text.ts";

export { searchConfig, sanitizeSnippet, toTsQuery, weightClass } from "./text.ts";

/** EmDash internals the patched call sites pass in, so behaviour matches the FTS5 path exactly. */
export interface EmDashSearchHelpers {
	localeMatches: (column: string, locale: string) => RawBuilder<unknown>;
	resolveConfiguredLocale: (locale: string) => string;
	encodeSearchCursor: (offset: number) => string;
	decodeSearchOffset: (cursor: string) => number;
}

interface SearchOptions {
	collections?: string[];
	status?: string;
	locale?: string;
	limit?: number;
	cursor?: string;
	scope?: "all" | "title";
}

export interface SearchResult {
	collection: string;
	id: string;
	slug: string | null;
	locale: string;
	title?: string;
	snippet?: string;
	score: number;
}

interface CollectionMeta {
	slug: string;
	fields: Array<{ slug: string; type: string }>;
	weights?: Record<string, number>;
	titleField?: string;
	hasTitle: boolean;
}

const IDENT_RE = /^[a-z][a-z0-9_]*$/;
const JSON_TYPES = new Set(["portableText", "json"]);
const HEADLINE_OPTIONS = `StartSel=${START_SEL}, StopSel=${STOP_SEL}, MaxWords=32, MinWords=12, MaxFragments=1`;

// biome-ignore lint/suspicious/noExplicitAny: accepts any Kysely instance, like EmDash's dialect helpers
export function isPostgres(db: Kysely<any>): boolean {
	const adapter = db.getExecutor().adapter;
	return adapter instanceof PostgresAdapter || adapter?.constructor?.name === "PostgresAdapter";
}

// biome-ignore lint/suspicious/noExplicitAny: EmDash's Database type isn't exported
type Db = Kysely<any>;

/** Search-enabled collections with their searchable fields, in one query. */
export async function getSearchMetadata(db: Db, slugs?: string[]): Promise<Map<string, CollectionMeta>> {
	const rows = await sql<{ slug: string; search_config: string | null; title_field: string | null; fields: Array<{ slug: string; type: string }> | null; has_title: boolean }>`
		SELECT c.slug, c.search_config, c.title_field,
			json_agg(json_build_object('slug', f.slug, 'type', f.type)) FILTER (WHERE f.searchable = 1) AS fields,
			coalesce(bool_or(f.slug = 'title'), false) AS has_title
		FROM _emdash_collections c
		LEFT JOIN _emdash_fields f ON f.collection_id = c.id
		WHERE c.search_config IS NOT NULL
		${slugs?.length ? sql`AND c.slug = ANY(${slugs})` : sql``}
		GROUP BY c.id, c.slug, c.search_config, c.title_field
	`.execute(db);

	const out = new Map<string, CollectionMeta>();
	for (const row of rows.rows) {
		let config: { enabled?: unknown; weights?: unknown } | null = null;
		try {
			config = row.search_config ? JSON.parse(row.search_config) : null;
		} catch {
			continue;
		}
		if (config?.enabled !== true || !IDENT_RE.test(row.slug)) continue;
		const fields = (row.fields ?? []).filter((f) => IDENT_RE.test(f.slug));
		if (fields.length === 0) continue;
		const weights = config.weights && typeof config.weights === "object" ? (config.weights as Record<string, number>) : undefined;
		const titleField = row.title_field && IDENT_RE.test(row.title_field) ? row.title_field : undefined;
		out.set(row.slug, { slug: row.slug, fields, weights, titleField, hasTitle: row.has_title });
	}
	return out;
}

/** Plain text of one field: Portable Text and JSON via every nested `text` value, others cast to text. */
function fieldText(field: { slug: string; type: string }): RawBuilder<string> {
	const column = sql`c.${sql.ref(field.slug)}`;
	if (JSON_TYPES.has(field.type)) {
		return sql<string>`coalesce((SELECT string_agg(v #>> '{}', ' ') FROM jsonb_path_query(${column}::jsonb, 'strict $.**.text') AS v), '')`;
	}
	return sql<string>`coalesce(${column}::text, '')`;
}

function titleColumnOf(meta: CollectionMeta): string | undefined {
	const searchable = meta.fields.map((f) => f.slug);
	if (meta.titleField && searchable.includes(meta.titleField)) return meta.titleField;
	return searchable.includes("title") ? "title" : undefined;
}

async function searchOne(db: Db, meta: CollectionMeta, query: string, options: SearchOptions, limit: number, helpers: EmDashSearchHelpers): Promise<SearchResult[]> {
	const tsquery = toTsQuery(query);
	if (!tsquery) return [];
	const cfg = sql.lit(searchConfig());
	const titleColumn = titleColumnOf(meta);
	const indexed = options.scope === "title" ? meta.fields.filter((f) => f.slug === titleColumn) : meta.fields;
	if (indexed.length === 0) return [];

	const doc = sql.join(
		indexed.map((f) => sql`setweight(to_tsvector(${cfg}::regconfig, ${fieldText(f)}), ${sql.lit(weightClass(meta.weights?.[f.slug], f.slug === titleColumn))})`),
		sql` || `,
	);
	const bodyFields = indexed.filter((f) => f.slug !== titleColumn);
	const body = sql.join((bodyFields.length ? bodyFields : indexed).map(fieldText), sql` || ' ' || `);
	const titleExpr = meta.titleField ? sql`c.${sql.ref(meta.titleField)}` : meta.hasTitle ? sql`c.title` : sql`NULL`;
	const locale = options.locale ? helpers.resolveConfiguredLocale(options.locale) : undefined;

	const rows = await sql<{ id: string; slug: string | null; locale: string; title: string | null; score: number; snippet: string | null }>`
		WITH q AS (SELECT to_tsquery(${cfg}::regconfig, ${tsquery}) AS q),
		docs AS (
			SELECT c.id, c.slug, c.locale, ${titleExpr}::text AS title, ${doc} AS doc, ${body} AS body
			FROM ${sql.table(`ec_${meta.slug}`)} c
			WHERE c.status = ${options.status ?? "published"} AND c.deleted_at IS NULL
			${locale ? sql`AND ${helpers.localeMatches("c.locale", locale)}` : sql``}
		),
		hits AS (
			SELECT docs.*, ts_rank(docs.doc, q.q) AS score
			FROM docs, q WHERE docs.doc @@ q.q
			ORDER BY score DESC, docs.id
			LIMIT ${limit}
		)
		SELECT hits.id, hits.slug, hits.locale, hits.title, hits.score,
			ts_headline(${cfg}::regconfig, hits.body, q.q, ${HEADLINE_OPTIONS}) AS snippet
		FROM hits, q
		ORDER BY hits.score DESC, hits.id
	`.execute(db);

	return rows.rows.map((r) => ({
		collection: meta.slug,
		id: r.id,
		slug: r.slug,
		locale: r.locale,
		title: r.title ?? undefined,
		snippet: sanitizeSnippet(r.snippet),
		// ts_rank is small (0–1); scale so scores read like EmDash's bm25 magnitudes
		score: Number(r.score) * 100,
	}));
}

/** Drop-in for EmDash's `searchWithDb` on Postgres. */
export async function searchWithDb(db: Db, query: string, options: SearchOptions = {}, helpers: EmDashSearchHelpers) {
	const limit = options.limit ?? 20;
	const offset = options.cursor ? helpers.decodeSearchOffset(options.cursor) : 0;
	if (!toTsQuery(query)) return { items: [] as SearchResult[] };
	const metadata = await getSearchMetadata(db, options.collections);
	const collections = options.collections?.length ? options.collections : [...metadata.keys()];

	const all: SearchResult[] = [];
	for (const collection of collections) {
		const meta = metadata.get(collection);
		if (meta) all.push(...(await searchOne(db, meta, query, options, offset + limit + 1, helpers)));
	}
	all.sort((a, b) => b.score - a.score);
	const items = all.slice(offset, offset + limit);
	return { items, nextCursor: all.length > offset + limit ? helpers.encodeSearchCursor(offset + limit) : undefined };
}

/** Drop-in for EmDash's `searchCollection` on Postgres. */
export async function searchCollection(db: Db, collection: string, query: string, options: SearchOptions = {}, helpers: EmDashSearchHelpers) {
	return searchWithDb(db, query, { ...options, collections: [collection] }, helpers);
}

/** Drop-in for EmDash's `getSuggestions` on Postgres: title prefix matches, best first. */
export async function getSuggestions(db: Db, query: string, options: { collections?: string[]; locale?: string; limit?: number } = {}, helpers: EmDashSearchHelpers) {
	const limit = options.limit ?? 5;
	if (!toTsQuery(query)) return [];
	const metadata = await getSearchMetadata(db, options.collections);
	const collections = options.collections?.length ? options.collections : [...metadata.keys()];
	const suggestions: Array<{ collection: string; id: string; slug: string | null; title: string }> = [];
	for (const collection of collections) {
		const meta = metadata.get(collection);
		if (!meta || (!meta.titleField && !meta.hasTitle)) continue;
		const hits = await searchOne(db, meta, query, { locale: options.locale, scope: "title" }, limit, helpers);
		for (const hit of hits) if (hit.title) suggestions.push({ collection, id: hit.id, slug: hit.slug, title: hit.title });
	}
	return suggestions.slice(0, limit);
}
