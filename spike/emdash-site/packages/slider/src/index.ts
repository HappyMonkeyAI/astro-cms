/**
 * Slider (carousel) block for astro-cms sites.
 *
 * A trusted (native) plugin: site-side block renderers (`componentsEntry`) are native-only in EmDash.
 * The block's editor form is declared on the descriptor, which is what the admin reads.
 *
 * @example
 * ```js
 * emdash({ plugins: [slider()] });
 * ```
 */

import type { PluginDescriptor } from "emdash";

import { SLIDER_BLOCK } from "./block.ts";

export { BLOCK_TYPE, normalizeSlider, type Slide, type SliderData } from "./block.ts";

export function slider(): PluginDescriptor {
	return {
		id: "slider",
		version: "0.1.0",
		entrypoint: "@astro-cms/slider/plugin",
		componentsEntry: "@astro-cms/slider/components",
		format: "native",
		options: {},
		capabilities: [],
		portableTextBlocks: [SLIDER_BLOCK],
	};
}
