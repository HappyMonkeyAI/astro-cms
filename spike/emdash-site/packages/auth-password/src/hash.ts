/**
 * scrypt password hashing via node:crypto (no native dependencies).
 *
 * Stored format: `scrypt$N$r$p$<salt b64>$<key b64>`. Parameters are stored per
 * hash so they can be raised later without invalidating existing passwords.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// Bounds for parameters read back from storage, so a tampered row can't
// trigger an expensive derivation.
const MAX_N = 131_072;
const MAX_R = 16;
const MAX_P = 4;

export const MAX_PASSWORD_LENGTH = 256;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
	const maxmem = 256 * (options.N ?? N) * (options.r ?? R) + 1024 * 1024;
	return new Promise((resolve, reject) => {
		scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem }, (err, key) =>
			err ? reject(err) : resolve(key),
		);
	});
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LENGTH);
	const key = await scrypt(password, salt, { N, r: R, p: P });
	return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 6 || parts[0] !== "scrypt") return false;

	const [n, r, p] = parts.slice(1, 4).map(Number);
	if (!Number.isInteger(n) || n > MAX_N || (n & (n - 1)) !== 0) return false;
	if (!Number.isInteger(r) || r < 1 || r > MAX_R) return false;
	if (!Number.isInteger(p) || p < 1 || p > MAX_P) return false;
	if (password.length > MAX_PASSWORD_LENGTH) return false;

	const salt = Buffer.from(parts[4], "base64");
	const expected = Buffer.from(parts[5], "base64");
	if (expected.length !== KEY_LENGTH) return false;

	const actual = await scrypt(password, salt, { N: n, r, p });
	return timingSafeEqual(actual, expected);
}

/** Returns an error message, or null when the password is acceptable. */
export function checkPasswordPolicy(password: string, minLength = 12): string | null {
	if (password.length < minLength) return `Password must be at least ${minLength} characters`;
	if (password.length > MAX_PASSWORD_LENGTH)
		return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
	return null;
}

let dummyHash: Promise<string> | undefined;

/** A real hash to verify against when the user doesn't exist, so timing doesn't reveal it. */
export function getDummyHash(): Promise<string> {
	dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
	return dummyHash;
}
