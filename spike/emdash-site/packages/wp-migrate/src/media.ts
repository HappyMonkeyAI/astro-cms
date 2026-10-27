/**
 * Resolve WordPress media references to EmDash media library items, using the report
 * from EmDash's media import (`POST /import/wordpress/media` → `imported[]`).
 */

export interface ImportedMedia {
	wpId: number;
	originalUrl: string;
	newUrl: string;
	mediaId: string;
}

export interface ResolvedMedia {
	mediaId?: string;
	url: string;
	/** True when the item was found in the media library */
	local: boolean;
}

/** `photo-150x150.jpg` → `photo.jpg`: WordPress size variants of one attachment */
const SIZE_SUFFIX = /-\d+x\d+(?=\.[a-z0-9]+$)/i;

export function createMediaResolver(imported: ImportedMedia[]) {
	const byWpId = new Map(imported.map((m) => [m.wpId, m]));
	const byUrl = new Map(imported.map((m) => [normaliseUrl(m.originalUrl), m]));
	return (ref: { attachmentId?: number; url: string }): ResolvedMedia => {
		const hit =
			(ref.attachmentId !== undefined ? byWpId.get(ref.attachmentId) : undefined) ??
			byUrl.get(normaliseUrl(ref.url)) ??
			byUrl.get(normaliseUrl(ref.url).replace(SIZE_SUFFIX, ""));
		return hit ? { mediaId: hit.mediaId, url: hit.newUrl, local: true } : { url: ref.url, local: false };
	};
}

function normaliseUrl(url: string): string {
	return url.trim().replace(/^https?:/i, "").replace(/[?#].*$/, "");
}
