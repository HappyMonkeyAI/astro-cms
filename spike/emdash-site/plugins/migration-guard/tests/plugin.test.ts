import { afterEach, describe, expect, it } from "vitest";

import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";

import { scanData, summarise } from "../src/scan";

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const block = (text: string) => ({ _type: "block", children: [{ _type: "span", text }] });

describe("scanData", () => {
	it("counts known shortcodes once per opening tag and ignores ordinary brackets", () => {
		const data = {
			title: "Gallery [sic] post [1]",
			content: [block('[gallery columns="2"]'), block('[caption id="x"]<img>[/caption]'), block("[caption]")],
		};
		const result = scanData(data, []);
		expect(result.shortcodes).toEqual({ gallery: 1, caption: 2 });
		expect(result.legacyUrls).toBe(0);
	});

	it("flags legacy hosts including subdomains, but not other hosts", () => {
		const data = {
			content: [
				{ _type: "image", asset: { url: "https://files.oldsite.com/2008/06/a.jpg" } },
				block("see https://oldsite.com/about and https://example.org/x"),
			],
		};
		const result = scanData(data, ["https://oldsite.com/"]);
		expect(result.legacyUrls).toBe(2);
		expect(result.sampleUrls).toHaveLength(2);
		expect(summarise(result)).toBe("2 legacy-host URLs");
	});
});

describe("publish policy", () => {
	it("rejects entries with leftovers and logs the origin", async () => {
		host = await createPluginTestHost();
		const decision = await host.invokeHook("content:beforePublish", {
			collection: "posts",
			origin: { source: "mcp" },
			actor: { id: "user_1", role: 50, source: "mcp" },
			content: { id: "p1", slug: "gallery", data: { title: "G", content: [block("[gallery]")] } },
		});
		expect(decision).toMatchObject({ cancel: true });
		expect(String((decision as { reason: string }).reason)).toContain("[gallery]");

		const log = await host.storage("publish_log").list();
		expect(log).toHaveLength(1);
		expect(log[0]!.data).toMatchObject({ origin: "mcp", decision: "rejected", actorId: "user_1" });
	});

	it("allows clean entries", async () => {
		host = await createPluginTestHost();
		const decision = await host.invokeHook("content:beforePublish", {
			collection: "posts",
			origin: { source: "api" },
			content: { id: "p2", slug: "clean", data: { title: "Clean", content: [block("All good")] } },
		});
		expect(decision ?? undefined).toBeUndefined();
	});
});

describe("issue tracking", () => {
	it("records issues on save and clears them when fixed", async () => {
		host = await createPluginTestHost();
		const save = (text: string) =>
			host!.invokeHook("content:afterSave", {
				collection: "posts",
				isNew: false,
				content: { id: "p3", slug: "post", data: { title: "Post", content: [block(text)] } },
			});

		type Listed = { total: number; items: Array<{ shortcodes: object }> };
		await save("[audio src=x]");
		let listed = (await host.invokeRoute("issues", {})) as Listed;
		expect(listed.total).toBe(1);
		expect(listed.items[0]!.shortcodes).toEqual({ audio: 1 });

		await save("fixed");
		listed = (await host.invokeRoute("issues", {})) as Listed;
		expect(listed.total).toBe(0);
	});

	it("scans existing content and saves legacy hosts", async () => {
		host = await createPluginTestHost();
		await host.createCollection({
			slug: "posts",
			label: "Posts",
			fields: [
				{ slug: "title", label: "Title", type: "string" },
				{ slug: "body", label: "Body", type: "text" },
			],
		});
		await host.seedContent("posts", [
			{ slug: "a", title: "A", body: "[gallery ids=1,2]" },
			{ slug: "b", title: "B", body: "https://old.example.com/img.jpg" },
			{ slug: "c", title: "C", body: "clean" },
		]);

		const result = (await host.invokeRoute("scan", { legacyHosts: ["old.example.com"] })) as {
			scanned: number;
			flagged: number;
		};
		expect(result).toMatchObject({ scanned: 3, flagged: 2 });
		expect(((await host.invokeRoute("issues", {})) as { total: number }).total).toBe(2);
		// GET query values arrive as strings
		const limited = (await host.invokeRoute("issues", { limit: "1" })) as { ok: boolean; items: unknown[] };
		expect(limited).toMatchObject({ ok: true });
		expect(limited.items).toHaveLength(1);
	});
});
