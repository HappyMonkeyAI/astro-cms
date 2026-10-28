import type { ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

import { SLIDER_BLOCK } from "./block.ts";

export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: "slider",
		version: "0.1.0",
		capabilities: [],
		admin: { portableTextBlocks: [SLIDER_BLOCK] },
	});
}

export default createPlugin;
