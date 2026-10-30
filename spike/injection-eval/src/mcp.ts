/**
 * Minimal client for EmDash's MCP server (Streamable HTTP, stateless). Unlike wp-migrate's
 * client, tool results come back raw (text plus the error flag), because the model under
 * test sees exactly what the server returns, errors included.
 */

export interface McpTool {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface McpResult {
	text: string;
	isError: boolean;
}

export interface Mcp {
	listTools(): Promise<McpTool[]>;
	call(name: string, args: Record<string, unknown>): Promise<McpResult>;
	/** Call and parse JSON; throws on a tool error. For setup and scoring, never for the model. */
	json<T = any>(name: string, args: Record<string, unknown>): Promise<T>;
}

export async function connectMcp(baseUrl: string, token: string): Promise<Mcp> {
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
	await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "astro-cms-injection-eval", version: "0.1.0" } });

	const call = async (name: string, args: Record<string, unknown>): Promise<McpResult> => {
		try {
			const result = await rpc("tools/call", { name, arguments: args });
			const text = (result?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
			return { text, isError: Boolean(result?.isError) };
		} catch (error) {
			return { text: error instanceof Error ? error.message : String(error), isError: true };
		}
	};
	return {
		async listTools() {
			return (await rpc("tools/list", {}))?.tools ?? [];
		},
		call,
		async json(name, args) {
			const r = await call(name, args);
			if (r.isError) throw new Error(`${name}: ${r.text.slice(0, 400)}`);
			try {
				return JSON.parse(r.text);
			} catch {
				return r.text as any;
			}
		},
	};
}
