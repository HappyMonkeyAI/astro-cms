/**
 * Agent accounts: one non-admin user per AI agent, owning that agent's API token.
 *
 * EmDash checks the *token owner's* role (and attributes edits to the owner), so an agent
 * token created by an admin acts as that admin: agent-guard can't tell its publishes apart
 * and the audit trail names the admin (spike F17). An agent account fixes both. It has a
 * reserved `@agents.invalid` address (can never receive email) and no credentials, so
 * nobody can sign in as it; disabling it revokes its tokens at once.
 */

export const AGENT_EMAIL_DOMAIN = "agents.invalid";
const ROLES = { author: 30, editor: 40 } as const;
const MAX_LIFETIME_MS = 366 * 86_400_000;

export interface AgentRequest {
	name: string;
	role: number;
	scopes: string[];
	expiresAt: string;
}

/** Validate an agent-account request; returns the problem as a string, or the clean request. */
export function parseAgentRequest(
	body: unknown,
	isValidScope: (scope: string) => boolean,
	now = Date.now(),
): AgentRequest | string {
	const b = (body ?? {}) as Record<string, unknown>;
	const name = typeof b.name === "string" ? b.name.trim() : "";
	if (!name || name.length > 80) return "name is required (1-80 characters)";
	const role = b.role === undefined ? ROLES.editor : b.role;
	if (role !== ROLES.author && role !== ROLES.editor) return "role must be 30 (author) or 40 (editor); agents are never admins";
	if (!Array.isArray(b.scopes) || b.scopes.length === 0 || !b.scopes.every((s) => typeof s === "string")) return "scopes must be a non-empty list";
	const scopes = [...new Set(b.scopes as string[])];
	if (scopes.includes("admin")) return "agents can't have the admin scope";
	const invalid = scopes.filter((s) => !isValidScope(s));
	if (invalid.length) return `invalid scopes: ${invalid.join(", ")}`;
	const expires = typeof b.expiresAt === "string" ? Date.parse(b.expiresAt) : Number.NaN;
	if (!Number.isFinite(expires) || expires <= now) return "expiresAt must be a future ISO date";
	if (expires - now > MAX_LIFETIME_MS) return "agent tokens can last at most a year";
	return { name, role, scopes, expiresAt: new Date(expires).toISOString() };
}

/** `content-agent` → `content-agent-k3x9q2@agents.invalid` (unique, never deliverable). */
export function agentEmail(name: string, random: string): string {
	const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
	return `${slug}-${random}@${AGENT_EMAIL_DOMAIN}`;
}

export function isAgentEmail(email: string): boolean {
	return email.toLowerCase().endsWith(`@${AGENT_EMAIL_DOMAIN}`);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID (time-sortable id), the format EmDash uses for its own token ids. */
export function ulid(now = Date.now(), random: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): string {
	let time = "";
	let t = now;
	for (let i = 0; i < 10; i++) {
		time = CROCKFORD[t % 32] + time;
		t = Math.floor(t / 32);
	}
	let rand = "";
	for (let i = 0; i < 16; i++) rand += CROCKFORD[random[i] % 32];
	return time + rand;
}
