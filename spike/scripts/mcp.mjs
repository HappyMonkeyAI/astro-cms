#!/usr/bin/env node
/**
 * Minimal MCP client for EmDash's built-in server (Streamable HTTP, stateless).
 *
 *   node spike/scripts/mcp.mjs list [--full]          list tools (full schemas saved to results/mcp-tools.json)
 *   node spike/scripts/mcp.mjs schema <tool>          print one tool's input schema
 *   node spike/scripts/mcp.mjs call <tool> '<json>'   call a tool, print the result ('-' = read JSON from stdin)
 *
 * Auth: personal access token in spike/emdash-site/.mcp-token or EMDASH_TOKEN.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const endpoint = process.env.EMDASH_MCP_URL ?? "http://localhost:4321/_emdash/api/mcp";
const token =
	process.env.EMDASH_TOKEN ??
	(await readFile(join(here, "..", "emdash-site", ".mcp-token"), "utf8").catch(() => "")).trim();

let nextId = 1;
async function rpc(method, params) {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": "2025-06-18",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
	// Either a JSON body or an SSE stream with `data:` lines.
	const payload = text.trimStart().startsWith("{")
		? JSON.parse(text)
		: text
				.split("\n")
				.filter((l) => l.startsWith("data:"))
				.map((l) => JSON.parse(l.slice(5)))
				.find((m) => m.id !== undefined);
	if (payload?.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
	return payload?.result;
}

const [command, name, rawArgs] = process.argv.slice(2);
await rpc("initialize", {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "astro-cms-spike", version: "0.1.0" },
});

if (command === "list") {
	const tools = [];
	let cursor;
	do {
		const page = await rpc("tools/list", cursor ? { cursor } : {});
		tools.push(...page.tools);
		cursor = page.nextCursor;
	} while (cursor);
	await mkdir(join(here, "..", "results"), { recursive: true });
	await writeFile(join(here, "..", "results", "mcp-tools.json"), `${JSON.stringify(tools, null, 2)}\n`);
	for (const t of tools) {
		const flags = Object.entries(t.annotations ?? {})
			.filter(([k, v]) => k.endsWith("Hint") && v === true)
			.map(([k]) => k.replace("Hint", ""))
			.join(",");
		console.log(`${t.name}${flags ? ` [${flags}]` : ""}  ${process.argv.includes("--full") ? t.description : (t.description ?? "").split("\n")[0].slice(0, 110)}`);
	}
	console.log(`\n${tools.length} tools`);
} else if (command === "schema") {
	const { tools } = await rpc("tools/list", {});
	const tool = tools.find((t) => t.name === name);
	console.log(JSON.stringify(tool ?? `no tool ${name}`, null, 2));
} else if (command === "call") {
	// '-' reads the arguments from stdin (Windows caps command lines at ~32 KB)
	const argText = rawArgs === "-" ? await new Response(process.stdin).text() : rawArgs;
	const result = await rpc("tools/call", { name, arguments: argText ? JSON.parse(argText) : {} });
	for (const part of result?.content ?? []) {
		if (part.type === "text") {
			try {
				console.log(JSON.stringify(JSON.parse(part.text), null, 2));
			} catch {
				console.log(part.text);
			}
		} else console.log(JSON.stringify(part));
	}
	if (result?.isError) process.exitCode = 1;
} else {
	console.error("usage: mcp.mjs list [--full] | schema <tool> | call <tool> '<json>'");
	process.exit(2);
}
