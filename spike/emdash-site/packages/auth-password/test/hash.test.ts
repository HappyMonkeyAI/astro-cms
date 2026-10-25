import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPasswordPolicy, hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from "../src/hash.ts";

test("hash round-trips and rejects wrong passwords", async () => {
	const hash = await hashPassword("correct horse battery staple");
	assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
	assert.equal(await verifyPassword("correct horse battery staple", hash), true);
	assert.equal(await verifyPassword("correct horse battery stapler", hash), false);
});

test("salts differ between hashes of the same password", async () => {
	assert.notEqual(await hashPassword("same password here"), await hashPassword("same password here"));
});

test("unicode is normalised before hashing", async () => {
	const hash = await hashPassword("café au lait 123");
	assert.equal(await verifyPassword("café au lait 123", hash), true);
});

test("malformed or tampered hashes verify as false instead of throwing", async () => {
	for (const stored of ["", "bcrypt$x", "scrypt$1$8$1$a$b", "scrypt$1048576$8$1$c2FsdA==$a2V5", "scrypt$32768$8$1$c2FsdA==$c2hvcnQ="]) {
		assert.equal(await verifyPassword("anything long enough", stored), false, stored);
	}
});

test("password policy enforces min and max length", () => {
	assert.match(checkPasswordPolicy("short")!, /at least 12/);
	assert.equal(checkPasswordPolicy("twelve chars"), null);
	assert.match(checkPasswordPolicy("x".repeat(MAX_PASSWORD_LENGTH + 1))!, /at most/);
	assert.equal(checkPasswordPolicy("eight ch", 8), null);
});
