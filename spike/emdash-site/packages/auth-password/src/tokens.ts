/**
 * Pure logic for password-reset tokens and email 2FA codes.
 *
 * Secrets are random (node:crypto) and only their hashes are stored. Records
 * are single-use (the atomic `delete` result decides who consumed it), expire,
 * and are compared in constant time. Storage is injected so this is testable
 * without a database.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const RESET_TTL_MS = 30 * 60_000;
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;

/** The subset of EmDash's StorageCollection used here. */
export interface Store<T> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	/** Resolves true only for the caller that actually removed the row. */
	delete(id: string): Promise<boolean>;
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- reset tokens

/** Stored under the user id, so issuing a new token replaces (invalidates) the old one. */
export interface ResetRecord {
	hash: string;
	expiresAt: number;
}

// `<userId>.<43 chars base64url of 32 random bytes>`
const RESET_TOKEN = /^([A-Za-z0-9]{1,64})\.([A-Za-z0-9_-]{43})$/;

export function parseResetToken(token: string): { userId: string; secret: string } | null {
	const match = RESET_TOKEN.exec(token);
	return match ? { userId: match[1], secret: match[2] } : null;
}

export async function issueResetToken(
	store: Store<ResetRecord>,
	userId: string,
	now = Date.now(),
): Promise<string> {
	const secret = randomBytes(32).toString("base64url");
	await store.put(userId, { hash: sha256Hex(secret), expiresAt: now + RESET_TTL_MS });
	return `${userId}.${secret}`;
}

/** Validate without consuming (used by the GET page and before hashing a password). */
export async function checkResetToken(
	store: Store<ResetRecord>,
	token: string,
	now = Date.now(),
): Promise<string | null> {
	const parsed = parseResetToken(token);
	if (!parsed) return null;
	const record = await store.get(parsed.userId);
	// Always compare, so a missing record takes the same path as a wrong secret.
	const matches = safeEqual(record?.hash ?? sha256Hex("missing"), sha256Hex(parsed.secret));
	if (!record || !matches) return null;
	if (record.expiresAt <= now) {
		await store.delete(parsed.userId);
		return null;
	}
	return parsed.userId;
}

/** Validate and invalidate. Returns the user id for exactly one caller. */
export async function consumeResetToken(
	store: Store<ResetRecord>,
	token: string,
	now = Date.now(),
): Promise<string | null> {
	const userId = await checkResetToken(store, token, now);
	if (!userId) return null;
	return (await store.delete(userId)) ? userId : null;
}

// ------------------------------------------------------------------ 2FA codes

/** Stored under sha256(challengeId). */
export interface ChallengeRecord {
	userId: string;
	salt: string;
	codeHash: string;
	expiresAt: number;
	attempts: number;
}

export function generateCode(): string {
	return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export const hashCode = (code: string, salt: string) =>
	createHmac("sha256", salt).update(code).digest("hex");

/** Accepts "123456" or "123 456"; returns null for anything else. */
export function normalizeCode(input: string): string | null {
	const code = input.replace(/\s+/g, "");
	return /^\d{6}$/.test(code) ? code : null;
}

export async function issueChallenge(
	store: Store<ChallengeRecord>,
	userId: string,
	now = Date.now(),
): Promise<{ challengeId: string; code: string }> {
	const challengeId = randomBytes(32).toString("base64url");
	const code = generateCode();
	const salt = randomBytes(16).toString("hex");
	await store.put(sha256Hex(challengeId), {
		userId,
		salt,
		codeHash: hashCode(code, salt),
		expiresAt: now + CODE_TTL_MS,
		attempts: 0,
	});
	return { challengeId, code };
}

export type ChallengeResult =
	| { ok: true; userId: string }
	| { ok: false; reason: "invalid" | "expired" | "locked" };

// Serialise attempts per challenge within this process, so parallel guesses
// can't all read the same attempt counter.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = locks.get(key) ?? Promise.resolve();
	const run = previous.then(fn, fn);
	const tail = run.catch(() => undefined);
	locks.set(key, tail);
	try {
		return await run;
	} finally {
		if (locks.get(key) === tail) locks.delete(key);
	}
}

export function verifyChallenge(
	store: Store<ChallengeRecord>,
	challengeId: string,
	codeInput: string,
	now = Date.now(),
): Promise<ChallengeResult> {
	const key = sha256Hex(challengeId);
	return withLock(key, async (): Promise<ChallengeResult> => {
		const record = await store.get(key);
		if (!record) return { ok: false, reason: "invalid" };
		if (record.expiresAt <= now) {
			await store.delete(key);
			return { ok: false, reason: "expired" };
		}
		if (record.attempts >= MAX_CODE_ATTEMPTS) {
			await store.delete(key);
			return { ok: false, reason: "locked" };
		}
		const code = normalizeCode(codeInput);
		const matches = safeEqual(hashCode(code ?? "000000", record.salt), record.codeHash);
		if (!code || !matches) {
			const attempts = record.attempts + 1;
			if (attempts >= MAX_CODE_ATTEMPTS) await store.delete(key);
			else await store.put(key, { ...record, attempts });
			return { ok: false, reason: attempts >= MAX_CODE_ATTEMPTS ? "locked" : "invalid" };
		}
		// Single use: only the caller whose delete removed the row succeeds.
		return (await store.delete(key)) ? { ok: true, userId: record.userId } : { ok: false, reason: "invalid" };
	});
}
