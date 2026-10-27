/**
 * Token presets (SPEC §5.4). Agents never get `admin`: with the destructive-tools patch,
 * only admin-scope tokens can permanently delete content, collections, fields, media,
 * taxonomies or menus, and agent-guard sends MCP publishes by non-admins to an editor.
 */

export interface TokenProfile {
	description: string;
	scopes: string[];
	/** Default lifetime in days */
	days: number;
}

export const PROFILES: Record<string, TokenProfile> = {
	"agent-editor": {
		description: "Drafts and edits content and media; publishing goes to an editor for approval",
		scopes: ["content:read", "content:write", "media:read", "media:write", "schema:read", "mcp:tools:migration-guard", "mcp:tools:agent-guard"],
		days: 90,
	},
	"agent-readonly": {
		description: "Reads content, media and schema (search, summaries, audits); cannot change anything",
		scopes: ["content:read", "media:read", "schema:read"],
		days: 90,
	},
	migration: {
		description: "Full access for a wp-migrate run; short-lived",
		scopes: ["admin"],
		days: 1,
	},
};

/** Parse `30d`, `12h` or a plain number of days. */
export function parseLifetime(value: string | undefined, fallbackDays: number): number {
	if (!value) return fallbackDays * 86_400_000;
	const match = value.trim().match(/^(\d+)\s*([dh]?)$/i);
	if (!match) throw new Error(`Invalid lifetime "${value}": use e.g. 30d or 12h`);
	const n = Number(match[1]);
	if (n <= 0) throw new Error("Lifetime must be positive");
	return match[2].toLowerCase() === "h" ? n * 3_600_000 : n * 86_400_000;
}
