import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCodeEmail, buildResetEmail, resetPageHtml } from "../src/emails.ts";
import { checkPasswordPolicy } from "../src/hash.ts";
import {
	CODE_TTL_MS,
	consumeResetToken,
	checkResetToken,
	generateCode,
	hashCode,
	issueChallenge,
	issueResetToken,
	MAX_CODE_ATTEMPTS,
	normalizeCode,
	parseResetToken,
	RESET_TTL_MS,
	safeEqual,
	sha256Hex,
	verifyChallenge,
	type ChallengeRecord,
	type ResetRecord,
	type Store,
} from "../src/tokens.ts";

function memoryStore<T>(): Store<T> & { rows: Map<string, T> } {
	const rows = new Map<string, T>();
	return {
		rows,
		get: async (id) => rows.get(id) ?? null,
		put: async (id, data) => void rows.set(id, structuredClone(data)),
		delete: async (id) => rows.delete(id),
	};
}

const USER = "01HZXABCDEFGHJKMNPQRSTVWXY";

// ---- reset tokens

test("reset token is random, parseable and stored only as a hash", async () => {
	const store = memoryStore<ResetRecord>();
	const a = await issueResetToken(store, USER);
	const parsed = parseResetToken(a);
	assert.equal(parsed?.userId, USER);
	assert.equal(parsed?.secret.length, 43);
	const row = store.rows.get(USER)!;
	assert.equal(row.hash, sha256Hex(parsed!.secret));
	assert.ok(!JSON.stringify(row).includes(parsed!.secret));
	assert.notEqual(a, await issueResetToken(memoryStore<ResetRecord>(), USER));
});

test("reset token is single use", async () => {
	const store = memoryStore<ResetRecord>();
	const token = await issueResetToken(store, USER);
	assert.equal(await consumeResetToken(store, token), USER);
	assert.equal(await consumeResetToken(store, token), null);
	assert.equal(store.rows.size, 0);
});

test("reset token expires after 30 minutes", async () => {
	const store = memoryStore<ResetRecord>();
	const now = 1_000_000;
	const token = await issueResetToken(store, USER, now);
	assert.equal(await checkResetToken(store, token, now + RESET_TTL_MS - 1), USER);
	assert.equal(await consumeResetToken(store, token, now + RESET_TTL_MS), null);
	assert.equal(store.rows.size, 0, "expired record is removed");
});

test("a newer reset token invalidates the older one", async () => {
	const store = memoryStore<ResetRecord>();
	const first = await issueResetToken(store, USER);
	const second = await issueResetToken(store, USER);
	assert.equal(await consumeResetToken(store, first), null);
	assert.equal(await consumeResetToken(store, second), USER);
});

test("wrong secret, malformed and unknown-user tokens are rejected and don't burn the real one", async () => {
	const store = memoryStore<ResetRecord>();
	const token = await issueResetToken(store, USER);
	const forged = `${USER}.${"A".repeat(43)}`;
	for (const bad of [forged, "", "nodot", `${USER}.short`, `OTHER.${parseResetToken(token)!.secret}`, `${USER}.${"A".repeat(43)}x`]) {
		assert.equal(await consumeResetToken(store, bad), null, bad);
	}
	assert.equal(await consumeResetToken(store, token), USER);
});

test("concurrent consumers: only one wins", async () => {
	const store = memoryStore<ResetRecord>();
	const token = await issueResetToken(store, USER);
	const results = await Promise.all([consumeResetToken(store, token), consumeResetToken(store, token)]);
	assert.equal(results.filter(Boolean).length, 1);
});

test("new password goes through the policy", () => {
	assert.match(checkPasswordPolicy("short")!, /at least 12/);
	assert.equal(checkPasswordPolicy("a-long-enough-password"), null);
});

test("safeEqual handles length mismatch", () => {
	assert.equal(safeEqual("abc", "abc"), true);
	assert.equal(safeEqual("abc", "abd"), false);
	assert.equal(safeEqual("abc", "abcd"), false);
});

// ---- 2FA codes

test("codes are 6 digits, zero padded, and vary", () => {
	const seen = new Set<string>();
	for (let i = 0; i < 200; i++) {
		const code = generateCode();
		assert.match(code, /^\d{6}$/);
		seen.add(code);
	}
	assert.ok(seen.size > 150);
});

test("normalizeCode accepts spaces, rejects junk", () => {
	assert.equal(normalizeCode("123 456"), "123456");
	assert.equal(normalizeCode(" 000123 "), "000123");
	for (const bad of ["12345", "1234567", "abcdef", "", "12-3456"]) assert.equal(normalizeCode(bad), null);
});

test("challenge stores only a salted hash of the code, keyed by hashed id", async () => {
	const store = memoryStore<ChallengeRecord>();
	const { challengeId, code } = await issueChallenge(store, USER, 5);
	assert.equal(store.rows.has(challengeId), false);
	const row = store.rows.get(sha256Hex(challengeId))!;
	assert.equal(row.codeHash, hashCode(code, row.salt));
	assert.ok(!JSON.stringify(row).includes(code));
	assert.equal(row.expiresAt, 5 + CODE_TTL_MS);
});

test("correct code verifies once, then is gone", async () => {
	const store = memoryStore<ChallengeRecord>();
	const { challengeId, code } = await issueChallenge(store, USER);
	assert.deepEqual(await verifyChallenge(store, challengeId, code), { ok: true, userId: USER });
	assert.deepEqual(await verifyChallenge(store, challengeId, code), { ok: false, reason: "invalid" });
});

test("code with a space is accepted", async () => {
	const store = memoryStore<ChallengeRecord>();
	const { challengeId, code } = await issueChallenge(store, USER);
	const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
	assert.equal((await verifyChallenge(store, challengeId, spaced)).ok, true);
});

test("code expires after 10 minutes", async () => {
	const store = memoryStore<ChallengeRecord>();
	const now = 10_000;
	const { challengeId, code } = await issueChallenge(store, USER, now);
	assert.deepEqual(await verifyChallenge(store, challengeId, code, now + CODE_TTL_MS), { ok: false, reason: "expired" });
	assert.equal(store.rows.size, 0);
});

test("wrong codes are counted and lock the challenge, even for the right code afterwards", async () => {
	const store = memoryStore<ChallengeRecord>();
	const { challengeId, code } = await issueChallenge(store, USER);
	const wrong = code === "000000" ? "000001" : "000000";
	for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
		assert.deepEqual(await verifyChallenge(store, challengeId, wrong), { ok: false, reason: "invalid" });
	}
	assert.deepEqual(await verifyChallenge(store, challengeId, wrong), { ok: false, reason: "locked" });
	assert.deepEqual(await verifyChallenge(store, challengeId, code), { ok: false, reason: "invalid" });
	assert.equal(store.rows.size, 0);
});

test("unknown challenge id and malformed codes fail", async () => {
	const store = memoryStore<ChallengeRecord>();
	assert.deepEqual(await verifyChallenge(store, "nope", "123456"), { ok: false, reason: "invalid" });
	const { challengeId } = await issueChallenge(store, USER);
	assert.equal((await verifyChallenge(store, challengeId, "abc")).ok, false);
});

test("parallel guesses can't exceed the attempt limit", async () => {
	const store = memoryStore<ChallengeRecord>();
	const { challengeId, code } = await issueChallenge(store, USER);
	const wrong = code === "000000" ? "000001" : "000000";
	const results = await Promise.all(Array.from({ length: 20 }, () => verifyChallenge(store, challengeId, wrong)));
	// Exactly MAX attempts reach the comparison (the last one locks); the rest find no record.
	assert.equal(results.filter((r) => !r.ok && r.reason === "locked").length, 1);
	assert.equal(store.rows.size, 0);
	assert.deepEqual(await verifyChallenge(store, challengeId, code), { ok: false, reason: "invalid" });
});

test("a code from a different challenge does not verify", async () => {
	const store = memoryStore<ChallengeRecord>();
	const a = await issueChallenge(store, USER);
	const b = await issueChallenge(store, "OTHERUSER");
	if (a.code !== b.code) assert.equal((await verifyChallenge(store, a.challengeId, b.code)).ok, false);
});

// ---- emails

test("emails carry the link/code and escape HTML", () => {
	const reset = buildResetEmail({ to: "a@b.c", siteName: "<b>Site</b>", url: "https://x.test/r?token=a.b&x=1" });
	assert.ok(reset.text.includes("https://x.test/r?token=a.b&x=1"));
	assert.ok(!reset.html!.includes("<b>Site</b>"));
	const code = buildCodeEmail({ to: "a@b.c", siteName: "Site", code: "123456" });
	assert.ok(code.text.includes("123456") && code.html!.includes("123456"));
});

test("reset page escapes the token and shows states", () => {
	assert.ok(!resetPageHtml({ token: '"><script>x</script>' }).includes("<script>"));
	assert.match(resetPageHtml({ token: null }), /invalid or has expired/);
	assert.match(resetPageHtml({ token: null, done: true }), /has been changed/);
});
