import assert from "node:assert/strict";
import { test } from "node:test";

import { createRateLimiter } from "../src/rate-limit.ts";

test("blocks after maxAttempts failures and unblocks after the window", () => {
	let t = 0;
	const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 1000, now: () => t });

	for (let i = 0; i < 3; i++) {
		assert.equal(limiter.isBlocked("k"), false);
		limiter.recordFailure("k");
	}
	assert.equal(limiter.isBlocked("k"), true);
	assert.equal(limiter.isBlocked("other"), false);

	t = 1000;
	assert.equal(limiter.isBlocked("k"), false);
});

test("reset clears failures after a successful login", () => {
	const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 1000 });
	limiter.recordFailure("k");
	limiter.reset("k");
	limiter.recordFailure("k");
	assert.equal(limiter.isBlocked("k"), false);
});
