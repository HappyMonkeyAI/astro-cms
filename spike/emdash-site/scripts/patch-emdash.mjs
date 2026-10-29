/**
 * Spike patches for emdash 1.3.1 on Node. Runs after `npm install`, before `astro build`
 * (the patched modules are bundled into dist). Each patch is a candidate upstream fix.
 *
 * F11 (SSRF resolver): the SSRF guard always resolves hostnames via Cloudflare's public
 *     DoH endpoint, so every external fetch (e.g. WordPress media import) fails on networks
 *     that block DoH. On Node, use the system resolver; non-public-IP validation still applies.
 *
 * F18 (OAuth env): Google/Microsoft/GitHub credentials are read from `import.meta.env`, which
 *     Vite inlines at build time on Node. Runtime env vars are ignored ("provider not
 *     configured") and build-time secrets end up in dist/. On Node, read process.env at
 *     request time, keeping build-time values only as a fallback.
 *
 * SPEC §5.4 (irreversible MCP tools need the admin scope): destructive MCP tools check the
 *     token's scope (e.g. content:write) and the token *owner's* role. Agency agent tokens are
 *     created by admins, so the role check passes and a content-only token can permanently
 *     delete content (spike F15). Require the `admin` token scope as well. Only applies to
 *     token-authenticated calls (requireScope skips session users); trashing stays allowed.
 *
 * F2 (Postgres search): search is SQLite FTS5 only, so on Postgres `search()`, the search and
 *     suggest APIs and the MCP search tool return nothing, and enabling search throws. On
 *     Postgres, hand off to @astro-cms/pg-search (tsvector, same result shapes), and let
 *     enable/disable record the setting instead of throwing.
 *
 * F30 (plugin unique indexes): a plugin's `uniqueIndexes` become a unique index over the
 *     whole shared _plugin_storage table on (plugin_id, collection, data.field) with no WHERE
 *     clause, so it also applies to every other plugin's rows. Once the forms plugin declares
 *     `slug` unique, any two rows in any plugin collection with the same `slug` value collide
 *     (migration-guard's scan failed on two entries sharing a slug). Make unique indexes
 *     partial, scoped to their own plugin and collection, under a new name so the existing
 *     unscoped index is dropped as an orphan.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MARK = "/* astro-cms spike patch */";
const PATCHES = [
	{
		id: "F11 ssrf system resolver",
		dir: "node_modules/emdash/dist",
		file: /^ssrf-.*\.mjs$/,
		target: "const resolver = options?.resolver ?? defaultResolver ?? cloudflareDohResolver;",
		replacement: `const resolver = options?.resolver ?? defaultResolver ?? (globalThis.process?.versions?.node ? async (host) => {
		const { lookup } = await import("node:dns/promises");
		return (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
	} : cloudflareDohResolver); ${MARK}`,
	},
	{
		id: "F18 oauth runtime env",
		dir: "node_modules/emdash/dist/astro/routes/api/auth/oauth",
		file: /^_provider_\.mjs$/,
		target: "getOAuthConfig(cfEnv ?? import.meta.env)",
		replacement: `getOAuthConfig(cfEnv ?? { ...import.meta.env, ...globalThis.process?.env }) ${MARK}`,
	},
	{
		id: "F18 oauth runtime env (callback)",
		dir: "node_modules/emdash/dist/astro/routes/api/auth/oauth/_provider_",
		file: /^callback\.mjs$/,
		target: "getOAuthConfig(cfEnv ?? import.meta.env,",
		replacement: `getOAuthConfig(cfEnv ?? { ...import.meta.env, ...globalThis.process?.env }, ${MARK}`,
	},
	{
		id: "SPEC 5.4 destructive MCP tools need the admin scope",
		dir: "node_modules/emdash/dist/astro/routes/api",
		file: /^mcp\.mjs$/,
		// Every match must be patched, and exactly this many tools must match
		pattern:
			/(server\.registerTool\("(?:content_permanent_delete|schema_delete_collection|schema_delete_field|media_delete|taxonomy_delete|menu_delete)",[\s\S]*?requireScope\(extra, "[a-z:]+"\);)/g,
		expected: 6,
		replacement: `$1 requireScope(extra, "admin"); ${MARK}`,
	},
	{
		id: "F2 pg-search import",
		dir: "node_modules/emdash/dist",
		file: /^search-.*\.mjs$/,
		target: `import { toPlainText } from "@portabletext/toolkit";`,
		replacement: `import { toPlainText } from "@portabletext/toolkit";
import * as __pgSearch from "@astro-cms/pg-search"; ${MARK}
const __pgHelpers = () => ({ localeMatches, resolveConfiguredLocale, encodeSearchCursor, decodeSearchOffset });`,
	},
	{
		id: "F2 pg-search searchWithDb",
		dir: "node_modules/emdash/dist",
		file: /^search-.*\.mjs$/,
		target: "async function searchWithDb(db, query, options = {}) {",
		replacement: `async function searchWithDb(db, query, options = {}) {
	if (__pgSearch.isPostgres(db)) return __pgSearch.searchWithDb(db, query, options, __pgHelpers()); ${MARK}`,
	},
	{
		id: "F2 pg-search searchCollection",
		dir: "node_modules/emdash/dist",
		file: /^search-.*\.mjs$/,
		target: "async function searchCollection(db, collection, query, options = {}) {",
		replacement: `async function searchCollection(db, collection, query, options = {}) {
	if (__pgSearch.isPostgres(db)) return __pgSearch.searchCollection(db, collection, query, options, __pgHelpers()); ${MARK}`,
	},
	{
		id: "F2 pg-search getSuggestions",
		dir: "node_modules/emdash/dist",
		file: /^search-.*\.mjs$/,
		target: "async function getSuggestions(db, query, options = {}) {",
		replacement: `async function getSuggestions(db, query, options = {}) {
	if (__pgSearch.isPostgres(db)) return __pgSearch.getSuggestions(db, query, options, __pgHelpers()); ${MARK}`,
	},
	{
		id: "F2 enableSearch on Postgres",
		dir: "node_modules/emdash/dist",
		file: /^fts-manager-.*\.mjs$/,
		target: `if (!isSqlite(this.db)) throw new Error("Full-text search is only available with SQLite databases");`,
		replacement: `if (!isSqlite(this.db)) {
			if ((await this.getSearchableFields(collectionSlug)).length === 0) throw new Error("No searchable fields defined for collection \\"" + collectionSlug + "\\". Mark at least one field as searchable before enabling search.");
			const existing = await this.getSearchConfig(collectionSlug);
			await this.setSearchConfig(collectionSlug, { enabled: true, weights: options?.weights ?? existing?.weights, tokenize: options?.tokenize ?? existing?.tokenize });
			return;
		} ${MARK}`,
	},
	{
		id: "F30 scoped unique storage indexes (name)",
		dir: "node_modules/emdash/dist",
		file: /^api-.*\.mjs$/,
		// New name, so orphan cleanup drops the old unscoped index on existing sites
		target: "return `${options?.unique ? \"uidx\" : \"idx\"}_plugin_",
		replacement: "return `${options?.unique ? \"suidx\" : \"idx\"}_plugin_",
	},
	{
		id: "F30 scoped unique storage indexes (where)",
		dir: "node_modules/emdash/dist",
		file: /^api-.*\.mjs$/,
		target: `	return sql\`\${sql.raw(createKeyword)} IF NOT EXISTS \${sql.ref(indexName)}
		ON _plugin_storage(plugin_id, collection, \${sql.raw(expressions)})
	\`;`,
		replacement: `	const scope = options?.unique ? \` WHERE plugin_id = '\${pluginId.replace(/'/g, "''")}' AND collection = '\${collection.replace(/'/g, "''")}'\` : ""; ${MARK}
	return sql\`\${sql.raw(createKeyword)} IF NOT EXISTS \${sql.ref(indexName)}
		ON _plugin_storage(plugin_id, collection, \${sql.raw(expressions)})\${sql.raw(scope)}
	\`;`,
	},
	{
		id: "F2 disableSearch on Postgres",
		dir: "node_modules/emdash/dist",
		file: /^fts-manager-.*\.mjs$/,
		target: `async disableSearch(collectionSlug) {
		if (!isSqlite(this.db)) return;`,
		replacement: `async disableSearch(collectionSlug) {
		if (!isSqlite(this.db)) {
			const existing = await this.getSearchConfig(collectionSlug);
			await this.setSearchConfig(collectionSlug, { enabled: false, weights: existing?.weights, tokenize: existing?.tokenize });
			return;
		} ${MARK}`,
	},
];

let failures = 0;
for (const patch of PATCHES) {
	const files = (await readdir(patch.dir)).filter((f) => patch.file.test(f));
	let applied = false;
	for (const file of files) {
		const path = join(patch.dir, file);
		const source = await readFile(path, "utf8");
		if (patch.pattern) {
			const already = source.split(`requireScope(extra, "admin"); ${MARK}`).length - 1;
			if (already === patch.expected) {
				applied = true;
				continue;
			}
			const found = source.match(patch.pattern)?.length ?? 0;
			if (found !== patch.expected) {
				console.error(`patch [${patch.id}] expected ${patch.expected} matches in ${path}, found ${found}`);
				continue;
			}
			await writeFile(path, source.replace(patch.pattern, patch.replacement));
			applied = true;
			console.log(`patched [${patch.id}] ${path} (${found} tools)`);
			continue;
		}
		if (source.includes(patch.replacement)) {
			applied = true;
			continue;
		}
		if (!source.includes(patch.target)) continue;
		await writeFile(path, source.replace(patch.target, patch.replacement));
		applied = true;
		console.log(`patched [${patch.id}] ${path}`);
	}
	if (!applied) {
		console.error(`patch [${patch.id}] did not apply: target not found (emdash changed?)`);
		failures++;
	}
}
if (failures) process.exit(1);
