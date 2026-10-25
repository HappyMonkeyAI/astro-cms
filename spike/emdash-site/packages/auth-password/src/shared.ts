import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { PasswordAuthConfig } from "./auth.ts";

export const PROVIDER_ID = "password";

export const STORAGE = {
	// Keyed by EmDash user id: { hash, updatedAt }
	credentials: { indexes: [] as string[] },
};

export interface PasswordCredential {
	hash: string;
	updatedAt: string;
}

interface EmdashLocals {
	db: Kysely<unknown>;
	config?: {
		database?: { type?: string };
		authProviders?: Array<{ id: string; config?: unknown }>;
	} | null;
}

export function getProviderConfig(emdash: EmdashLocals): PasswordAuthConfig {
	const provider = emdash.config?.authProviders?.find((p) => p.id === PROVIDER_ID);
	return (provider?.config ?? {}) as PasswordAuthConfig;
}

export async function getCredentialStore(emdash: EmdashLocals) {
	const { getAuthProviderStorage } = await import("emdash/api/route-utils");
	const storage = getAuthProviderStorage(
		emdash.db as Parameters<typeof getAuthProviderStorage>[0],
		PROVIDER_ID,
		STORAGE,
	);
	return storage.credentials as {
		get(id: string): Promise<PasswordCredential | null>;
		put(id: string, data: PasswordCredential): Promise<void>;
	};
}

// Same key as EmDash core's createFirstAdmin, so passkey and password setup
// serialise against each other on Postgres.
const FIRST_ADMIN_LOCK_KEY = 1_168_624_764;
const ADMIN_ROLE = 50;

/**
 * Insert the first admin only while the users table is empty.
 * Mirrors core's (unexported) createFirstAdmin; returns null if a user exists.
 */
export async function createFirstAdmin(
	emdash: EmdashLocals,
	input: { email: string; name: string | null },
): Promise<{ id: string } | null> {
	const { ulid } = await import("ulidx");
	const id = ulid();
	const now = new Date().toISOString();
	const insert = (executor: Kysely<unknown>) =>
		sql<{ id: string }>`
			INSERT INTO users (id, email, name, role, email_verified, created_at, updated_at)
			SELECT ${id}, ${input.email}, ${input.name}, CAST(${ADMIN_ROLE} AS integer), 0, ${now}, ${now}
			WHERE NOT EXISTS (SELECT 1 FROM users)
			RETURNING id
		`.execute(executor);

	const result =
		emdash.config?.database?.type === "postgres"
			? await emdash.db.transaction().execute(async (trx) => {
					await sql`SELECT pg_advisory_xact_lock(${FIRST_ADMIN_LOCK_KEY})`.execute(trx);
					return insert(trx);
				})
			: await insert(emdash.db);
	return result.rows.length > 0 ? { id } : null;
}

export function readClientAddress(getAddress: () => string): string {
	try {
		return getAddress();
	} catch {
		return "unknown";
	}
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body: unknown = await request.json();
		return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export const str = (value: unknown) => (typeof value === "string" ? value : "");
