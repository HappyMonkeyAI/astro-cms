/**
 * Minimal client for EmDash's MCP server (Streamable HTTP, stateless). Post-import
 * passes write through MCP so they get the same `_rev` checks, staged drafts and
 * audit origin as any other agent.
 */

export interface McpClient {
	call<T = any>(tool: string, args: Record<string, unknown>): Promise<T>;
}

export async function connectMcp(baseUrl: string, token: string): Promise<McpClient> {
	const endpoint = `${baseUrl.replace(/\/$/, "")}/_emdash/api/mcp`;
	let nextId = 1;
	const rpc = async (method: string, params: unknown) => {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": "2025-06-18",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
		});
		const text = await response.text();
		if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 300)}`);
		const payload = text.trimStart().startsWith("{")
			? JSON.parse(text)
			: text
					.split("\n")
					.filter((l) => l.startsWith("data:"))
					.map((l) => JSON.parse(l.slice(5)))
					.find((m) => m.id !== undefined);
		if (payload?.error) throw new Error(`MCP ${payload.error.code}: ${payload.error.message}`);
		return payload?.result;
	};
	await rpc("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "astro-cms-wp-migrate", version: "0.1.0" },
	});
	return {
		async call(tool, args) {
			const result = await rpc("tools/call", { name: tool, arguments: args });
			const text = (result?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
			if (result?.isError) throw new Error(`${tool}: ${text.slice(0, 400)}`);
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		},
	};
}
