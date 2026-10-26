/**
 * Spike patch (finding F11): on Node, make EmDash's SSRF guard resolve hostnames
 * with the system resolver (node:dns) instead of Cloudflare's public DoH endpoint.
 *
 * Upstream (emdash 1.3.1) always resolves via https://cloudflare-dns.com, so on
 * networks that block public DoH (common on corporate/on-prem networks) every
 * external fetch fails with SSRF_BLOCKED, e.g. all WordPress media imports.
 * The resolved addresses are still validated against the non-public IP rules.
 *
 * Runs after `npm install`, before `astro build` (the module is bundled into dist).
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dir = "node_modules/emdash/dist";
const TARGET = "const resolver = options?.resolver ?? defaultResolver ?? cloudflareDohResolver;";
const REPLACEMENT = `const resolver = options?.resolver ?? defaultResolver ?? (globalThis.process?.versions?.node ? async (host) => {
		const { lookup } = await import("node:dns/promises");
		return (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
	} : cloudflareDohResolver); /* astro-cms spike patch: system resolver on Node */`;

const files = (await readdir(dir)).filter((f) => /^ssrf-.*\.mjs$/.test(f));
let patched = 0;
for (const file of files) {
	const path = join(dir, file);
	const source = await readFile(path, "utf8");
	if (source.includes("astro-cms spike patch")) continue;
	if (!source.includes(TARGET)) continue;
	await writeFile(path, source.replace(TARGET, REPLACEMENT));
	patched++;
	console.log(`patched ${path}`);
}
if (patched === 0 && !files.length) throw new Error(`no ssrf module found in ${dir}; emdash layout changed`);
if (patched === 0) console.log("ssrf patch: nothing to do (already patched or target changed; check manually)");
