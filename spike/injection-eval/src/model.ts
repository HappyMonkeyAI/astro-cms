/**
 * The model under test, through any OpenAI-compatible chat completions endpoint
 * (LM Studio, llama.cpp, vLLM, Ollama, a hosted gateway). The model sees only the tools
 * the harness passes in: there is no shell, file or network tool.
 */

import type { McpTool } from "./mcp.ts";

export interface ModelConfig {
	/** e.g. http://127.0.0.1:1234/v1 */
	baseUrl: string;
	model: string;
	apiKey?: string;
	/** Per request; small local models can be slow */
	timeoutMs?: number;
	temperature?: number;
}

export interface ToolCall {
	id: string;
	name: string;
	/** Parsed arguments, or undefined when the model produced invalid JSON */
	args: Record<string, unknown> | undefined;
	rawArgs: string;
}

export interface Turn {
	text: string;
	toolCalls: ToolCall[];
	finishReason: string;
}

type ChatMessage =
	| { role: "system" | "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
	| { role: "tool"; tool_call_id: string; content: string };

export interface Conversation {
	next(): Promise<Turn>;
	/** Results for every tool call of the last turn, in order */
	addToolResults(results: { id: string; content: string }[]): void;
	messages: ChatMessage[];
}

/**
 * Replace local `$ref`s (`#/definitions/X`, `#/$defs/X`) with the definitions themselves.
 * Some local servers (LM Studio) can't resolve them. A cycle is cut to an open object.
 */
export function inlineRefs(schema: Record<string, unknown>): Record<string, unknown> {
	const defs = { ...(schema.definitions as object), ...(schema.$defs as object) } as Record<string, unknown>;
	const walk = (node: unknown, seen: string[]): unknown => {
		if (Array.isArray(node)) return node.map((n) => walk(n, seen));
		if (!node || typeof node !== "object") return node;
		const obj = node as Record<string, unknown>;
		const ref = typeof obj.$ref === "string" ? /^#\/(?:definitions|\$defs)\/(.+)$/.exec(obj.$ref)?.[1] : undefined;
		if (ref) {
			if (seen.includes(ref) || !(ref in defs)) return { type: "object" };
			const { $ref: _ref, ...rest } = obj;
			return { ...(walk(defs[ref], [...seen, ref]) as object), ...(walk(rest, seen) as object) };
		}
		return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "definitions" && k !== "$defs" && k !== "$schema").map(([k, v]) => [k, walk(v, seen)]));
	};
	return walk(schema, []) as Record<string, unknown>;
}

/** MCP input schemas → function definitions */
export function toFunctions(tools: McpTool[]) {
	return tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description ?? "", parameters: inlineRefs(t.inputSchema) } }));
}

export function startConversation(config: ModelConfig, system: string, user: string, tools: McpTool[]): Conversation {
	const messages: ChatMessage[] = [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
	const functions = toFunctions(tools);
	return {
		messages,
		async next() {
			const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
				body: JSON.stringify({ model: config.model, messages, tools: functions, tool_choice: "auto", temperature: config.temperature ?? 0.2 }),
				signal: AbortSignal.timeout(config.timeoutMs ?? 300_000),
			});
			if (!response.ok) throw new Error(`model HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
			const body = await response.json();
			const choice = body.choices?.[0];
			const message = choice?.message ?? {};
			const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((c: any, i: number) => {
				const rawArgs = typeof c.function?.arguments === "string" ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {});
				let args: Record<string, unknown> | undefined;
				try {
					const parsed = JSON.parse(rawArgs || "{}");
					args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
				} catch {
					args = undefined;
				}
				return { id: c.id || `call_${messages.length}_${i}`, name: c.function?.name ?? "", args, rawArgs };
			});
			messages.push({
				role: "assistant",
				content: message.content ?? null,
				...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.rawArgs } })) } : {}),
			});
			return { text: message.content ?? "", toolCalls, finishReason: choice?.finish_reason ?? "unknown" };
		},
		addToolResults(results) {
			for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
		},
	};
}
