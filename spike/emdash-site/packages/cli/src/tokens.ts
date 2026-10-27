/**
 * API token management through EmDash's admin API, authenticated with an admin-scope token.
 */

export interface TokenInfo {
	id: string;
	name: string;
	prefix: string;
	scopes: string[];
	expiresAt: string | null;
	lastUsedAt: string | null;
	createdAt: string;
}

export interface AgentAccount {
	id: string;
	name: string;
	email: string;
	role: number;
	disabled: boolean;
	tokens: { id: string; prefix: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null }[];
}

/** Agent accounts via @astro-cms/auth-password's /_emdash/api/agents and EmDash's user admin API. */
export function agentClient(base: string, adminToken: string) {
	const api = `${base.replace(/\/$/, "")}/_emdash/api`;
	const request = async (method: string, path: string, body?: unknown) => {
		const response = await fetch(api + path, {
			method,
			headers: { Authorization: `Bearer ${adminToken}`, "X-EmDash-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const json: any = await response.json().catch(() => ({}));
		if (!response.ok || json.success === false) throw new Error(`${method} ${path} -> ${response.status}: ${json?.error?.message ?? "request failed"}`);
		return json.data ?? json;
	};
	return {
		async create(name: string, scopes: string[], expiresAt: Date, role = 40): Promise<{ token: string; agent: { id: string; name: string; email: string; role: number }; info: { id: string; prefix: string; scopes: string[]; expiresAt: string } }> {
			return request("POST", "/agents", { name, scopes, role, expiresAt: expiresAt.toISOString() });
		},
		async list(): Promise<AgentAccount[]> {
			return (await request("GET", "/agents")).items ?? [];
		},
		async disable(id: string): Promise<void> {
			await request("POST", `/admin/users/${encodeURIComponent(id)}/disable`);
		},
	};
}

export function tokenClient(base: string, adminToken: string) {
	const root = `${base.replace(/\/$/, "")}/_emdash/api/admin/api-tokens`;
	const request = async (method: string, path = "", body?: unknown) => {
		const response = await fetch(root + path, {
			method,
			headers: {
				Authorization: `Bearer ${adminToken}`,
				"X-EmDash-Request": "1",
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const json: any = await response.json().catch(() => ({}));
		if (!response.ok || json.success === false) throw new Error(`${method} api-tokens${path} -> ${response.status}: ${json?.error?.message ?? "request failed"}`);
		return json.data ?? json;
	};
	return {
		async create(name: string, scopes: string[], expiresAt: Date): Promise<{ token: string; info: TokenInfo }> {
			return request("POST", "", { name, scopes, expiresAt: expiresAt.toISOString() });
		},
		async list(): Promise<TokenInfo[]> {
			return (await request("GET")).items ?? [];
		},
		async revoke(id: string): Promise<void> {
			await request("DELETE", `/${encodeURIComponent(id)}`);
		},
	};
}
