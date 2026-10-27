/**
 * Build Portable Text blocks for converted shortcodes, in the same shapes EmDash's
 * Gutenberg converter produces (image, gallery, embed with provider audio/video),
 * so the site's renderers treat them like natively imported blocks.
 */

import type { ResolvedMedia } from "./media.ts";
import type { PtBlock } from "./portable-text.ts";
import type { MediaRef, ShortcodeData } from "./shortcodes.ts";

export function buildBlocks(
	data: ShortcodeData,
	resolve: (ref: MediaRef) => ResolvedMedia,
	newKey: () => string,
	onExternal: (url: string) => void,
): PtBlock[] {
	const asset = (ref: MediaRef) => {
		const media = resolve(ref);
		if (!media.local) onExternal(ref.url);
		return { _type: "reference", _ref: media.mediaId ?? media.url, url: media.url };
	};
	switch (data.kind) {
		case "caption":
			return [
				{
					_type: "image",
					_key: newKey(),
					asset: asset(data.image),
					alt: data.image.alt,
					caption: data.caption,
					alignment: data.align,
					link: data.link,
				},
			];
		case "gallery":
			return [
				{
					_type: "gallery",
					_key: newKey(),
					images: data.images.map((image) => ({ _type: "image", _key: newKey(), asset: asset(image), alt: image.alt })),
					columns: data.columns,
				},
			];
		case "audio":
		case "video":
			return [{ _type: "embed", _key: newKey(), url: asset(data.media).url, provider: data.kind }];
		case "embed":
			return [{ _type: "embed", _key: newKey(), url: data.url, provider: detectProvider(data.url) }];
	}
}

/** Same provider detection as @emdash-cms/gutenberg-to-portable-text */
export function detectProvider(url: string): string | undefined {
	const u = url.toLowerCase();
	const providers: [string, string][] = [
		["youtube.com", "youtube"],
		["youtu.be", "youtube"],
		["vimeo.com", "vimeo"],
		["twitter.com", "twitter"],
		["x.com", "twitter"],
		["instagram.com", "instagram"],
		["facebook.com", "facebook"],
		["tiktok.com", "tiktok"],
		["spotify.com", "spotify"],
		["soundcloud.com", "soundcloud"],
		["codepen.io", "codepen"],
		["gist.github.com", "gist"],
	];
	return providers.find(([host]) => u.includes(host))?.[1];
}
