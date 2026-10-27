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
