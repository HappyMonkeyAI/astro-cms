/**
 * Pass: media from a local uploads folder (after EmDash's media import).
 *
 * EmDash's importer downloads each attachment from the old site. That fails when the old
 * host is offline, behind a firewall, or a local/LAN site (its SSRF guard blocks private
 * addresses; upstream #3815). With a copy of the site's `wp-content/uploads`, we upload
 * every attachment the importer couldn't fetch straight into the media library.
 */

import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type { McpClient } from "./mcp-client.ts";
import type { ImportedMedia } from "./media.ts";

export interface AttachmentRef {
	wpId: number;
	url: string;
}

const MAX_BYTES = 50 * 1024 * 1024;
const UPLOADS_SEGMENT = /\/wp-content\/uploads\/(.+)$/;
// WordPress.com (`site.files.wordpress.com/2008/06/a.jpg`) and CDN-rewritten URLs drop the
// prefix but keep the uploads folder's year/month layout
const DATED_UPLOAD = /\/((?:sites\/\d+\/)?\d{4}\/\d{2}\/[^/]+)$/;

const CONTENT_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".pdf": "application/pdf",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".zip": "application/zip",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentTypeFor(file: string): string {
	return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Path of a media URL inside the uploads folder (`2016/11/photo.jpg`, or
 * `sites/2/2016/11/photo.jpg` on multisite), from a `/wp-content/uploads/` URL or a
 * WordPress.com/CDN URL ending in `YYYY/MM/file`; undefined otherwise.
 * Query strings and fragments are ignored.
 */
export function uploadsRelativePath(url: string): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(url.startsWith("//") ? `https:${url}` : url).pathname;
	} catch {
		return undefined;
	}
	const match = pathname.match(UPLOADS_SEGMENT) ?? pathname.match(DATED_UPLOAD);
	if (!match) return undefined;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

/** Absolute path of the file for `url` inside `uploadsDir`, refusing anything that escapes it. */
export function localPathFor(uploadsDir: string, url: string): string | undefined {
	const rel = uploadsRelativePath(url);
	if (!rel) return undefined;
	const root = resolve(uploadsDir);
	const full = resolve(root, rel);
	const inside = relative(root, full);
	if (!inside || inside.startsWith("..") || isAbsolute(inside) || inside.split(sep).includes("..")) return undefined;
	return full;
}

/** Read a local file and register it in the media library. */
export async function uploadFile(mcp: McpClient, path: string, filename: string): Promise<{ mediaId: string; newUrl: string }> {
	const info = await stat(path);
	if (!info.isFile()) throw new Error("not a file");
	if (info.size > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
	return uploadBytes(mcp, await readFile(path), filename, contentTypeFor(filename));
}

/** `media_upload` (base64), returning the new media ID and URL. Identical bytes are de-duplicated by EmDash. */
export async function uploadBytes(mcp: McpClient, bytes: Buffer, filename: string, contentType: string): Promise<{ mediaId: string; newUrl: string }> {
	const uploaded = await mcp.call("media_upload", { filename, base64: bytes.toString("base64"), contentType });
	const item = uploaded?.item ?? uploaded;
	if (!item?.id) throw new Error("media_upload returned no id");
	return { mediaId: item.id, newUrl: item.url ?? `/_emdash/api/media/file/${item.storageKey}` };
}

export interface LocalMediaReport {
	uploaded: ImportedMedia[];
	missing: { wpId: number; url: string; reason: string }[];
	alreadyImported: number;
}

/** Upload every attachment that isn't already in `imported` from the local uploads folder. */
export async function uploadLocalMedia(options: {
	uploadsDir: string;
	attachments: AttachmentRef[];
	imported: ImportedMedia[];
	mcp: McpClient;
	dryRun?: boolean;
	log?: (line: string) => void;
}): Promise<LocalMediaReport> {
	const { mcp, dryRun, log = () => {} } = options;
	const done = new Set(options.imported.map((m) => m.wpId));
	const report: LocalMediaReport = { uploaded: [], missing: [], alreadyImported: 0 };
	for (const attachment of options.attachments) {
		if (done.has(attachment.wpId)) {
			report.alreadyImported++;
			continue;
		}
		const path = localPathFor(options.uploadsDir, attachment.url);
		if (!path) {
			report.missing.push({ ...attachment, reason: "not a wp-content/uploads URL" });
			continue;
		}
		try {
			if (dryRun) {
				await stat(path);
				continue;
			}
			const { mediaId, newUrl } = await uploadFile(mcp, path, path.split(sep).pop()!);
			report.uploaded.push({ wpId: attachment.wpId, originalUrl: attachment.url, newUrl, mediaId });
			log(`uploaded ${uploadsRelativePath(attachment.url)}`);
		} catch (error) {
			const reason = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "file not in the uploads folder" : error instanceof Error ? error.message : String(error);
			report.missing.push({ ...attachment, reason });
		}
	}
	return report;
}
