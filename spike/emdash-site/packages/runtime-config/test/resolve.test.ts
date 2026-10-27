import assert from "node:assert/strict";
import { test } from "node:test";

import { assertEnvName, readEnv } from "../src/shared.ts";

// The entrypoints import EmDash adapters, so only the pure resolvers are unit-tested
// here; the end-to-end check is building the image with no env (SPEC §5.1).

test("readEnv returns trimmed values and treats blank as unset", () => {
	assert.equal(readEnv("A", { A: " postgres://x " }), "postgres://x");
	assert.equal(readEnv("A", { A: "   " }), undefined);
	assert.equal(readEnv("A", {}), undefined);
});

test("assertEnvName rejects names that are not environment variables", () => {
	assert.equal(assertEnvName("DATABASE_URL"), "DATABASE_URL");
	assert.throws(() => assertEnvName("postgres://user:pass@host/db"), /not a valid environment variable name/);
	assert.throws(() => assertEnvName("1BAD"));
});
