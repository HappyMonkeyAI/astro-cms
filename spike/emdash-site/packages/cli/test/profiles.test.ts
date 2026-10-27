import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLifetime, PROFILES } from "../src/profiles.ts";

test("agent profiles never include admin or schema/settings write", () => {
	for (const name of ["agent-editor", "agent-readonly"]) {
		const scopes = PROFILES[name].scopes;
		assert.ok(!scopes.includes("admin"), `${name} must not be admin`);
		assert.ok(!scopes.some((s) => s === "schema:write" || s === "settings:manage"), `${name} must not change schema or settings`);
	}
	assert.ok(!PROFILES["agent-readonly"].scopes.some((s) => s.endsWith(":write") || s.endsWith(":manage")), "read-only profile has no write scopes");
	assert.deepEqual(PROFILES.migration.scopes, ["admin"]);
	assert.equal(PROFILES.migration.days, 1, "migration tokens are short-lived by default");
});

test("parseLifetime accepts days and hours", () => {
	assert.equal(parseLifetime("30d", 90), 30 * 86_400_000);
	assert.equal(parseLifetime("12h", 90), 12 * 3_600_000);
	assert.equal(parseLifetime("7", 90), 7 * 86_400_000);
	assert.equal(parseLifetime(undefined, 90), 90 * 86_400_000);
	assert.throws(() => parseLifetime("0d", 1), /positive/);
	assert.throws(() => parseLifetime("soon", 1), /Invalid lifetime/);
});
