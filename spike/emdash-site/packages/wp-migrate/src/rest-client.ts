/**
 * Minimal client for EmDash's admin REST API, for features without MCP tools
 * (e.g. redirects). Same token as the MCP passes.
 */

export interface RestClient {
	get<T = any>(path: string): Promise<T>;
	post<T = any>(path: string, body: unknown): Promise<T>;
}

export function connectRest(baseUrl: string, token: string): RestClient {
	const root = `${baseUrl.replace(/\/$/, "")}/_emdash/api`;
	const request = async (method: string, path: string, body?: unknown) => {
		const response = await fetch(root + path, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"X-EmDash-Request": "1",
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const json: any = await response.json().catch(() => ({}));
		if (!response.ok || json.success === false) {
			throw new Error(`${method} ${path} -> ${response.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
		}
		return json.data ?? json;
	};
	return { get: (path) => request("GET", path), post: (path, body) => request("POST", path, body) };
}
