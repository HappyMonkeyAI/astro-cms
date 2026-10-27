import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { PasswordAuthConfig } from "./auth.ts";
import type { EmailMessage } from "./emails.ts";
import type { ChallengeRecord, ResetRecord, Store } from "./tokens.ts";

export const PROVIDER_ID = "password";

export const STORAGE = {
	// Keyed by EmDash user id: { hash, updatedAt }
	credentials: { indexes: [] as string[] },
	// Keyed by user id: { hash, expiresAt } (password reset token, hashed)
	resets: { indexes: [] as string[] },
	// Keyed by sha256(challenge id): email 2FA code challenge (hashed code)
	challenges: { indexes: [] as string[] },
	// Keyed by user id: { enabledAt }; row present = email 2FA enabled
	twoFactor: { indexes: [] as string[] },
};

export interface PasswordCredential {
	hash: string;
	updatedAt: string;
}

export interface EmdashLocals {
	db: Kysely<unknown>;
	email?: {
		isAvailable(): boolean;
		send(message: EmailMessage, source: string): Promise<void>;
	} | null;
	config?: {
		database?: { type?: string };
		authProviders?: Array<{ id: string; config?: unknown }>;
	} | null;
}

export function getProviderConfig(emdash: EmdashLocals): PasswordAuthConfig {
	const provider = emdash.config?.authProviders?.find((p) => p.id === PROVIDER_ID);
	return (provider?.config ?? {}) as PasswordAuthConfig;
}

async function getStorage(emdash: EmdashLocals) {
	const { getAuthProviderStorage } = await import("emdash/api/route-utils");
	return getAuthProviderStorage(
		emdash.db as Parameters<typeof getAuthProviderStorage>[0],
		PROVIDER_ID,
		STORAGE,
	);
}

export async function getCredentialStore(emdash: EmdashLocals) {
	return (await getStorage(emdash)).credentials as Store<PasswordCredential>;
}

export async function getResetStore(emdash: EmdashLocals) {
	return (await getStorage(emdash)).resets as Store<ResetRecord>;
}

export async function getChallengeStore(emdash: EmdashLocals) {
	return (await getStorage(emdash)).challenges as Store<ChallengeRecord>;
}

export async function getTwoFactorStore(emdash: EmdashLocals) {
	return (await getStorage(emdash)).twoFactor as Store<{ enabledAt: string }> & {
		exists(id: string): Promise<boolean>;
	};
}

/**
 * Send through EmDash's email pipeline (the `email:deliver` transport, e.g.
 * @astro-cms/email-smtp), exactly as core's magic-link route does.
 * Throws when no transport is configured.
 */
export async function sendMail(emdash: EmdashLocals, message: EmailMessage): Promise<void> {
	if (!emdash.email?.isAvailable()) throw new Error("Email is not configured");
	await emdash.email.send(message, "system");
}

export async function getSiteName(emdash: EmdashLocals): Promise<string> {
	try {
		const { OptionsRepository } = await import("emdash/api/route-utils");
		const options = new OptionsRepository(emdash.db as never);
		const title = (await options.getMany(["emdash:site_title"])).get("emdash:site_title");
		return typeof title === "string" && title ? title : "EmDash";
	} catch {
		return "EmDash";
	}
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
