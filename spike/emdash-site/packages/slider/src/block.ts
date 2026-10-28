/**
 * The slider block: its editor form and the normaliser the renderer uses. No EmDash imports at runtime,
 * so this file is unit-testable on plain Node.
 *
 * The admin spreads Block Kit field values onto the Portable Text node by `action_id`:
 *   { _type: "slider", _key, slides: [{ image, alt, heading, text, link, linkLabel }], autoplay, interval, height }
 *
 * Repeater sub-fields can't use the media picker (spike F26), so each slide's image is a URL.
 * Copy it from the media library, or paste any https:// image URL.
 */

import type { PortableTextBlockConfig } from "emdash";

export const BLOCK_TYPE = "slider";
export const MAX_SLIDES = 12;
export const HEIGHTS = ["short", "medium", "tall"] as const;

export const SLIDER_BLOCK: PortableTextBlockConfig = {
	type: BLOCK_TYPE,
	label: "Slider",
	icon: "image",
	category: "Media",
	description: "A carousel of images with optional headings, text and buttons",
	fields: [
		{
			type: "repeater",
			action_id: "slides",
			label: "Slides",
			item_label: "Slide",
			min_items: 1,
			max_items: MAX_SLIDES,
			fields: [
				{ type: "text_input", action_id: "image", label: "Image URL", placeholder: "/_emdash/api/media/file/… or https://…" },
				{ type: "text_input", action_id: "alt", label: "Image description (alt text)", placeholder: "Describe the image for screen readers; leave empty if decorative" },
				{ type: "text_input", action_id: "heading", label: "Heading" },
				{ type: "text_input", action_id: "text", label: "Text", multiline: true },
				{ type: "text_input", action_id: "link", label: "Button link", placeholder: "/contact or https://…" },
				{ type: "text_input", action_id: "linkLabel", label: "Button text" },
			],
		},
		{ type: "toggle", action_id: "autoplay", label: "Play automatically", description: "Pauses on hover and focus, and never plays for visitors who prefer reduced motion", initial_value: false },
		{ type: "number_input", action_id: "interval", label: "Seconds per slide", initial_value: 6, min: 3, max: 30 },
		{
			type: "select",
			action_id: "height",
			label: "Height",
			initial_value: "medium",
			options: [
				{ value: "short", label: "Short" },
				{ value: "medium", label: "Medium" },
				{ value: "tall", label: "Tall" },
			],
		},
	],
};

export interface Slide {
	image: string;
	alt: string;
	heading: string;
	text: string;
	link?: string;
	linkLabel: string;
}

export interface SliderData {
	slides: Slide[];
	autoplay: boolean;
	interval: number;
	height: (typeof HEIGHTS)[number];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Site paths and http(s) URLs only; `javascript:`, `data:` and protocol-relative URLs are dropped. */
export function safeUrl(value: unknown): string | undefined {
	const url = str(value);
	if (/^\/(?!\/)/.test(url)) return url;
	if (/^https?:\/\//i.test(url)) return url;
	return undefined;
}

/** Turn whatever the editor saved into something safe to render. Slides without a usable image are skipped. */
export function normalizeSlider(node: Record<string, unknown> | null | undefined): SliderData {
	const raw = Array.isArray(node?.slides) ? node.slides : [];
	const slides: Slide[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const s = item as Record<string, unknown>;
		const image = safeUrl(s.image);
		if (!image) continue;
		const link = safeUrl(s.link);
		slides.push({ image, alt: str(s.alt), heading: str(s.heading), text: str(s.text), link, linkLabel: str(s.linkLabel) || (link ? "Find out more" : "") });
		if (slides.length === MAX_SLIDES) break;
	}
	const seconds = typeof node?.interval === "number" && Number.isFinite(node.interval) ? node.interval : 6;
	const height = HEIGHTS.includes(node?.height as SliderData["height"]) ? (node?.height as SliderData["height"]) : "medium";
	return { slides, autoplay: node?.autoplay === true && slides.length > 1, interval: Math.min(30, Math.max(3, seconds)) * 1000, height };
}
