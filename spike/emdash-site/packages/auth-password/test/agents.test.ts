import assert from "node:assert/strict";
import { test } from "node:test";

import { agentEmail, isAgentEmail, parseAgentRequest, ulid } from "../src/agents.ts";

const valid = (s: string) => ["content:read", "content:write", "media:read", "media:write", "schema:read", "admin"].includes(s) || /^mcp:tools:[a-z-]+$/.test(s);
const now = Date.parse("2026-10-27T12:00:00Z");
const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();

test("parseAgentRequest accepts an editor agent and defaults the role", () => {
	assert.deepEqual(parseAgentRequest({ name: " Content agent ", scopes: ["content:read", "content:write", "content:read"], expiresAt: inDays(90) }, valid, now), {
		name: "Content agent",
		role: 40,
		scopes: ["content:read", "content:write"],
		expiresAt: inDays(90),
	});
});

test("parseAgentRequest refuses admins, bad scopes and bad lifetimes", () => {
	const base = { name: "a", scopes: ["content:read"], expiresAt: inDays(30) };
	assert.match(parseAgentRequest({ ...base, role: 50 }, valid, now) as string, /never admins/);
	assert.match(parseAgentRequest({ ...base, scopes: ["admin"] }, valid, now) as string, /admin scope/);
	assert.match(parseAgentRequest({ ...base, scopes: ["root"] }, valid, now) as string, /invalid scopes: root/);
	assert.match(parseAgentRequest({ ...base, scopes: [] }, valid, now) as string, /non-empty/);
	assert.match(parseAgentRequest({ ...base, expiresAt: inDays(-1) }, valid, now) as string, /future/);
	assert.match(parseAgentRequest({ ...base, expiresAt: inDays(400) }, valid, now) as string, /at most a year/);
	assert.match(parseAgentRequest({ ...base, name: "" }, valid, now) as string, /name is required/);
});

test("agent emails are unique-ish, slugged and on the reserved .invalid domain", () => {
	assert.equal(agentEmail("Content Agent ✨", "k3x9q2"), "content-agent-k3x9q2@agents.invalid");
	assert.equal(agentEmail("***", "abc123"), "agent-abc123@agents.invalid");
	assert.ok(isAgentEmail("x-1@AGENTS.invalid"));
	assert.ok(!isAgentEmail("owner@clientbusiness.example"));
});

test("ulid is 26 Crockford characters and sorts by time", () => {
	const a = ulid(1_000, new Uint8Array(16));
	const b = ulid(2_000, new Uint8Array(16));
	assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
	assert.ok(a < b);
});
