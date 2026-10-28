import assert from "node:assert/strict";
import { test } from "node:test";

import { configuredToken, cookieValue, isGuardedPath, setupComplete, tokenMatches } from "../src/guard.ts";

test("guards every route that can create the first admin", () => {
	for (const path of ["/_emdash/api/setup", "/_emdash/api/setup/admin", "/_emdash/api/setup/admin/verify", "/_emdash/api/setup/password-admin", "/_emdash/api/setup/dev-bypass", "/_emdash/api/auth/oauth/google", "/_emdash/api/auth/oauth/google/callback", "/_emdash/api/auth/passkey/register/options", "/_emdash/api/auth/password/login"]) {
		assert.ok(isGuardedPath(path), path);
	}
	for (const path of ["/_emdash/api/setup/status", "/", "/_emdash/admin", "/_emdash/admin/setup", "/_emdash/api/search", "/_emdash/api/setupx"]) {
		assert.ok(!isGuardedPath(path), path);
	}
});

test("token must be configured and long enough", () => {
	assert.equal(configuredToken({}), undefined);
	assert.equal(configuredToken({ ASTRO_CMS_SETUP_TOKEN: "short" }), undefined);
	assert.equal(configuredToken({ ASTRO_CMS_SETUP_TOKEN: ` ${"x".repeat(24)} ` }), "x".repeat(24));
});

test("token comparison and cookie value", () => {
	const token = "t".repeat(32);
	assert.ok(tokenMatches(token, token));
	assert.ok(!tokenMatches("t".repeat(31), token));
	assert.ok(!tokenMatches("", token));
	assert.ok(!tokenMatches(null, token));
	assert.notEqual(cookieValue(token), token, "the cookie never carries the token itself");
	assert.equal(cookieValue(token), cookieValue(token));
	assert.notEqual(cookieValue(token), cookieValue(`${token}x`));
});

test("setup completion flag", () => {
	assert.ok(setupComplete(true));
	assert.ok(setupComplete("true"));
	assert.ok(!setupComplete(null));
	assert.ok(!setupComplete("false"));
});
