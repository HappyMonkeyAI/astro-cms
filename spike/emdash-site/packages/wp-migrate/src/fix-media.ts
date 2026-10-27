/**
 * Run the media URL pass over every entry in every collection, over MCP: read, rewrite,
 * write back with `_rev`, re-publish if published, then rebuild EmDash's media usage index.
 */

import { listCollections, listEntryIds, updateEntry } from "./entries.ts";
import { localPathFor, uploadBytes, uploadFile } from "./local-media.ts";
import type { McpClient } from "./mcp-client.ts";
import { createMediaResolver, type ImportedMedia } from "./media.ts";
import { legacyUrlPattern } from "./legacy-hosts.ts";
import { rewriteMediaRefs } from "./rewrite-media.ts";

export interface FixMediaOptions {
	legacyHosts: string[];
	media: ImportedMedia[];
	mcp: McpClient;
	/** Download legacy files that aren't in the media library (e.g. linked PDFs not attached in WordPress) and upload them */
	fetchMissing?: boolean;
	/** Local copy of wp-content/uploads: missing files are taken from here first */
	uploadsDir?: string;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface FetchedFile {
	url: string;
	mediaId?: string;
	error?: string;
}

const MAX_FETCH_BYTES = 50 * 1024 * 1024;
const FILE_EXTENSION = /\.[a-z0-9]{2,5}$/i;

export interface MediaOutcome {
	collection: string;
	slug: string;
	rewritten: number;
	unresolved: string[];
	republished: boolean;
	error?: string;
}

export async function fixMedia(
	options: FixMediaOptions,
): Promise<{ entries: MediaOutcome[]; fetched: FetchedFile[]; usageRepair?: unknown }> {
	const { mcp, dryRun, log = () => {} } = options;
	const legacyUrl = legacyUrlPattern(options.legacyHosts);
	const ids = new Map<string, string[]>();
	for (const { slug } of await listCollections(mcp)) ids.set(slug, await listEntryIds(mcp, slug));

	const media = [...options.media];
	const fetched: FetchedFile[] = [];
	if ((options.fetchMissing || options.uploadsDir) && !dryRun) {
		// Find legacy file URLs nothing resolves, fetch each once, and add it to the library
		const probe = { legacyUrl, resolve: createMediaResolver(media) };
		const missing = new Set<string>();
		for (const [collection, list] of ids) {
			for (const id of list) {
				const { item } = await mcp.call("content_get", { collection, id });
				for (const url of rewriteMediaRefs(item.data ?? {}, probe).unresolved) {
					const absolute = url.startsWith("//") ? `https:${url}` : url;
					if (FILE_EXTENSION.test(new URL(absolute).pathname)) missing.add(absolute.replace(/[?#].*$/, ""));
				}
			}
		}
		for (const url of missing) {
			const local = options.uploadsDir ? localPathFor(options.uploadsDir, url) : undefined;
			if (!local && !options.fetchMissing) continue;
			const result = local ? await uploadLocal(mcp, url, local) : await fetchAndUpload(mcp, url);
			fetched.push(result);
			log(result.mediaId ? `fetched ${url}` : `could not fetch ${url}: ${result.error}`);
			if (result.mediaId) media.push({ wpId: 0, originalUrl: url, newUrl: result.newUrl!, mediaId: result.mediaId });
		}
	}

	const rewriteOptions = { legacyUrl, resolve: createMediaResolver(media) };
	const entries: MediaOutcome[] = [];
	for (const [collection, list] of ids) {
		for (const id of list) {
			const { item, _rev } = await mcp.call("content_get", { collection, id });
			const outcome: MediaOutcome = { collection, slug: item.slug ?? id, rewritten: 0, unresolved: [], republished: false };
			const changed: Record<string, unknown> = {};
			for (const [field, value] of Object.entries(item.data ?? {})) {
				const result = rewriteMediaRefs(value, rewriteOptions);
				outcome.unresolved.push(...result.unresolved);
				if (result.rewritten) {
					outcome.rewritten += result.rewritten;
					changed[field] = result.value;
				}
			}
			if (!outcome.rewritten && !outcome.unresolved.length) continue;
			entries.push(outcome);
			if (!outcome.rewritten || dryRun) {
				log(`${collection}/${outcome.slug}: ${outcome.rewritten} to rewrite, ${outcome.unresolved.length} unresolved${dryRun ? " (dry run)" : ""}`);
				continue;
			}
			try {
				outcome.republished = await updateEntry(mcp, collection, item, _rev, changed);
				log(`${collection}/${outcome.slug}: rewrote ${outcome.rewritten}${outcome.unresolved.length ? `, ${outcome.unresolved.length} unresolved` : ""}${outcome.republished ? ", republished" : ""}`);
			} catch (error) {
				outcome.error = error instanceof Error ? error.message : String(error);
				log(`${collection}/${outcome.slug}: FAILED ${outcome.error}`);
			}
		}
	}
	const usageRepair = dryRun ? undefined : await mcp.call("media_usage_repair", { scope: "all" });
	return { entries, fetched, usageRepair };
}

async function fetchAndUpload(mcp: McpClient, url: string): Promise<FetchedFile & { newUrl?: string }> {
	try {
		const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
		if (!response.ok) return { url, error: `HTTP ${response.status}` };
		const declared = Number(response.headers.get("content-length") ?? 0);
		if (declared > MAX_FETCH_BYTES) return { url, error: `larger than ${MAX_FETCH_BYTES} bytes` };
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length > MAX_FETCH_BYTES) return { url, error: `larger than ${MAX_FETCH_BYTES} bytes` };
		const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
		return { url, ...(await uploadBytes(mcp, bytes, decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file"), contentType)) };
	} catch (error) {
		return { url, error: error instanceof Error ? error.message : String(error) };
	}
}

async function uploadLocal(mcp: McpClient, url: string, path: string): Promise<FetchedFile & { newUrl?: string }> {
	try {
		return { url, ...(await uploadFile(mcp, path, path.split(/[\\/]/).pop()!)) };
	} catch (error) {
		return { url, error: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "not in the uploads folder" : error instanceof Error ? error.message : String(error) };
	}
}

