import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, createPluginTestHost, type PluginRuntimeTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";

let host: PluginTestHost | undefined;
let runtime: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	await runtime?.dispose();
	host = undefined;
	runtime = undefined;
});

const editor = { id: "agent_editor", role: 40, source: "mcp" as const };
const admin = { id: "agent_admin", role: 50, source: "mcp" as const };
const mcp = { source: "mcp" as const };

interface Req {
	status: string;
	title: string;
	requestedBy: string | null;
	attempts: number;
	rev: string | null;
	decidedBy: string | null;
}

async function setup() {
	const r = await createPluginRuntimeTestHost();
	runtime = r;
	await r.fixtures.collection({
		slug: "pages",
		label: "Pages",
		fields: [
			{ slug: "title", label: "Title", type: "string" },
			{ slug: "body", label: "Body", type: "text" },
		],
	});
	const page = await r.fixtures.content("pages", { slug: "about", status: "draft", data: { title: "About", body: "reviewed text" } });
	const requests = () => r.inspect.storage.list<Req>("requests");
	const audit = () => r.inspect.storage.list<{ event: string; decision: string; origin: string | null }>("audit_log");
	const publish = async (actor: { id: string; role: number }, origin: object) => {
		const result = await r.actions.content.publish("pages", page.id, { actor, origin } as never);
		return result.success ? "published" : result.error.code;
	};
	return { r, page, requests, audit, publish };
}

const editorUser = (r: PluginRuntimeTestHost) =>
	r.fixtures.user({ email: "ed@example.com", name: "Ed", role: "editor" });

describe("policy (hook)", () => {
	it("holds MCP publishes by non-admins, allows everything else", async () => {
		host = await createPluginTestHost();
		const call = (origin: object, actor?: object) =>
			host!.invokeHook("content:beforePublish", { collection: "posts", origin, actor, content: { id: "p1", slug: "p", data: { title: "P" } } });
		expect(await call(mcp, editor)).toMatchObject({ cancel: true });
		expect(await call(mcp)).toMatchObject({ cancel: true }); // missing actor counts as below admin
		expect((await call(mcp, admin)) ?? undefined).toBeUndefined();
		for (const origin of [{ source: "api" }, { source: "visual-editor" }, { source: "scheduler" }, { source: "system" }, { source: "plugin", pluginId: "agent-guard" }]) {
			expect((await call(origin, editor)) ?? undefined).toBeUndefined();
		}
	});

	it("refuses MCP schedules and unpublishes by non-admins without creating a request (F33)", async () => {
		host = await createPluginTestHost();
		const content = { id: "p1", slug: "p", data: { title: "P" } };
		const schedule = (origin: object, actor?: object) =>
			host!.invokeHook("content:beforeSchedule", { collection: "posts", origin, actor, content, scheduledAt: "2030-01-01T00:00:00.000Z" });
		const unpublish = (origin: object, actor?: object) => host!.invokeHook("content:beforeUnpublish", { collection: "posts", origin, actor, content });
		for (const hook of [schedule, unpublish]) {
			expect(await hook(mcp, editor)).toMatchObject({ cancel: true, reason: expect.stringMatching(/agents can't/i) });
			expect(await hook(mcp)).toMatchObject({ cancel: true });
			expect((await hook(mcp, admin)) ?? undefined).toBeUndefined();
			expect((await hook({ source: "api" }, editor)) ?? undefined).toBeUndefined();
		}
		expect(await host.storage("requests").list()).toHaveLength(0);
	});
});

describe("approval flow on real content (runtime host)", () => {
	it("MCP editor publish is held as one pending request, even when repeated", async () => {
		const { r, page, requests, publish } = await setup();
		expect(await publish(editor, mcp)).toBe("PUBLISH_REJECTED");
		expect(await publish(editor, mcp)).toBe("PUBLISH_REJECTED");
		const list = await requests();
		expect(list).toHaveLength(1);
		expect(list[0]!.data).toMatchObject({ status: "pending", title: "About", requestedBy: "agent_editor", attempts: 2 });
		expect(list[0]!.data.rev).toBeTruthy();
		expect((await r.inspect.content.get("pages", page.id))!.status).toBe("draft");
	});

	it("allows MCP by admin and API/UI by an editor", async () => {
		const { r, page, requests, audit, publish } = await setup();
		expect(await publish(editor, { source: "api" })).toBe("published");
		await r.actions.content.unpublish("pages", page.id);
		expect(await publish(admin, mcp)).toBe("published");
		expect(await requests()).toHaveLength(0);
		expect((await audit()).every((e) => e.data.decision === "allowed")).toBe(true);
	});

	it("approve publishes the reviewed content, marks approved, and logs", async () => {
		const { r, page, requests, audit, publish } = await setup();
		await publish(editor, mcp);
		const user = await editorUser(r);
		const before = await r.admin.loadPage("/approvals", { user });
		expect(JSON.stringify(before)).toContain("About");
		const res = await r.admin.act("/approvals", "approve", { user, value: `pages:${page.id}` });
		expect(JSON.stringify(res)).toContain("Approved and published");
		expect((res as { toast?: { type: string } }).toast?.type).toBe("success");
		const live = await r.inspect.content.get("pages", page.id);
		expect(live!.status).toBe("published");
		expect(live!.data.body).toBe("reviewed text");
		expect((await requests())[0]!.data).toMatchObject({ status: "approved", decidedBy: user.id });
		const events = (await audit()).map((e) => `${e.data.event}:${e.data.origin}`);
		expect(events).toContain("approved:null");
		expect(events).toContain("policy:mcp");
		expect(events).toContain("policy:plugin:agent-guard"); // the plugin's own publish passes the policy
	});

	it("never publishes a draft that changed after the request", async () => {
		const { r, page, requests, publish } = await setup();
		await publish(editor, mcp);
		await r.actions.content.update("pages", page.id, { data: { body: "UNREVIEWED edit" } });
		const user = await editorUser(r);
		const res = await r.admin.act("/approvals", "approve", { user, value: `pages:${page.id}` });
		expect((res as { toast?: { type: string } }).toast?.type).toBe("error");
		expect((await r.inspect.content.get("pages", page.id))!.status).toBe("draft");
		expect((await requests())[0]!.data.status).toBe("stale");
		// A fresh agent publish re-opens it with the new revision, then approval works
		const staleRev = (await requests())[0]!.data.rev;
		await publish(editor, mcp);
		expect((await requests())[0]!.data).toMatchObject({ status: "pending" });
		expect((await requests())[0]!.data.rev).not.toBe(staleRev);
		await r.admin.act("/approvals", "approve", { user, value: `pages:${page.id}` });
		expect((await r.inspect.content.get("pages", page.id))!.data.body).toBe("UNREVIEWED edit");
	});

	it("reject leaves the draft and marks rejected", async () => {
		const { r, page, requests, audit, publish } = await setup();
		await publish(editor, mcp);
		const user = await editorUser(r);
		await r.admin.act("/approvals", "reject", { user, value: `pages:${page.id}` });
		expect((await r.inspect.content.get("pages", page.id))!.status).toBe("draft");
		expect((await requests())[0]!.data).toMatchObject({ status: "rejected", decidedBy: user.id });
		expect((await audit()).map((e) => e.data.event)).toContain("rejected");
	});

	it("exposes only a read-only requests MCP route and refuses decisions without an editor user", async () => {
		const { r, page, publish } = await setup();
		await publish(editor, mcp);
		expect((await r.actions.routes.request("requests", {})).status).toBe(401);
		const ed = await editorUser(r);
		const listed = await r.actions.routes.request("requests", { user: ed, headers: { "X-EmDash-Request": "1" } });
		expect(listed.status, await listed.clone().text()).toBe(200);
		expect(JSON.stringify(await listed.json())).toContain("About");
		const contributor = await r.fixtures.user({ email: "c@example.com", role: "contributor" });
		const res = await r.admin.act("/approvals", "approve", { user: contributor, value: `pages:${page.id}` }).catch((e) => e);
		expect((await r.inspect.content.get("pages", page.id))!.status).toBe("draft");
		expect(res).toBeDefined();
	});
});
