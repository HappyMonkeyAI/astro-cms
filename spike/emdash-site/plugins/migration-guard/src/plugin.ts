import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import { z } from "zod";

import { hasIssues, isNoWorse, normaliseHosts, scanData, summarise, type ScanResult } from "./scan";

/**
 * migration-guard: finds WordPress migration leftovers (raw shortcodes, legacy-host URLs),
 * keeps an issue list, and blocks publishing until an entry is clean.
 *
 * Every publish attempt the policy sees is logged with its origin (api, mcp, visual-editor,
 * plugin, scheduler, system) and actor, so agent activity can be audited.
 */

interface IssueRecord extends ScanResult {
	collection: string;
	entryId: string;
	slug: string | null;
	title: string;
	scannedAt: string;
}

interface PublishLogRecord {
	at: string;
	collection: string;
	entryId: string | null;
	slug: string | null;
	origin: string;
	actorId: string | null;
	decision: "allowed" | "rejected";
	reason: string | null;
}

// Minimal structural views of the host context, so this file only depends on the
// exported SandboxedPlugin type and stays portable across both sandbox runners.
interface Collection<T> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	query(options?: Record<string, unknown>): Promise<{ items: Array<{ id: string; data: T }>; cursor?: string; hasMore?: boolean }>;
	count(where?: Record<string, unknown>): Promise<number>;
}
type Ctx = PluginContext;
const issues = (ctx: Ctx) => ctx.storage.issues as unknown as Collection<IssueRecord>;
const publishLog = (ctx: Ctx) => ctx.storage.publish_log as unknown as Collection<PublishLogRecord>;

const SETTINGS_HOSTS = "legacyHosts";
const SCANNED_COLLECTIONS = 50;

async function getLegacyHosts(ctx: Ctx): Promise<string[]> {
	return (await ctx.settings.get<string[]>(SETTINGS_HOSTS)) ?? [];
}

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Record or clear the issue entry for one content item. Returns the scan result. */
async function recordScan(
	ctx: Ctx,
	collection: string,
	item: { id: string; slug: string | null; data: Record<string, unknown> },
	hosts: string[],
): Promise<ScanResult> {
	const result = scanData(item.data, hosts);
	const key = `${collection}:${item.id}`;
	if (hasIssues(result)) {
		await issues(ctx).put(key, {
			...result,
			collection,
			entryId: item.id,
			slug: item.slug,
			title: asString(item.data.title) ?? item.slug ?? item.id,
			scannedAt: new Date().toISOString(),
		});
	} else {
		await issues(ctx).delete(key);
	}
	return result;
}

/** Scan every entry in every collection (or the given ones). */
async function scanAll(ctx: Ctx, only?: string[]) {
	const hosts = await getLegacyHosts(ctx);
	const collections = (await ctx.schema!.listCollections())
		.map((c: { slug: string }) => c.slug)
		.filter((slug: string) => !only?.length || only.includes(slug))
		.slice(0, SCANNED_COLLECTIONS);
	let scanned = 0;
	let flagged = 0;
	for (const collection of collections) {
		let cursor: string | undefined;
		do {
			const page = await ctx.content!.list(collection, { limit: 100, ...(cursor ? { cursor } : {}) });
			for (const item of page.items) {
				scanned++;
				if (hasIssues(await recordScan(ctx, collection, item, hosts))) flagged++;
			}
			const next = page as { nextCursor?: string; cursor?: string; hasMore?: boolean };
			cursor = next.nextCursor ?? (next.hasMore ? next.cursor : undefined);
		} while (cursor);
	}
	return { collections, scanned, flagged, legacyHosts: hosts };
}

async function listIssues(ctx: Ctx, limit = 50) {
	const result = await issues(ctx).query({ orderBy: { scannedAt: "desc" }, limit });
	return { total: await issues(ctx).count(), items: result.items.map((i) => i.data) };
}

// ---------------------------------------------------------------- inputs

const scanInput = z.object({
	collections: z.array(z.string()).optional().describe("Collection slugs to scan; omit for all"),
	legacyHosts: z
		.array(z.string())
		.optional()
		.describe("Old WordPress/CDN hostnames to flag; saved for future scans and the publish gate"),
});
const issuesInput = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

const adminInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({ type: z.literal("block_action"), action_id: z.string(), value: z.unknown().optional() }),
	z.object({
		type: z.literal("form_submit"),
		action_id: z.string(),
		values: z.object({ hosts: z.string().optional() }).passthrough(),
	}),
]);

// ---------------------------------------------------------------- admin page

async function issuesPage(ctx: Ctx, toast?: { type: "success" | "error"; message: string }) {
	const [{ total, items }, hosts, rejected, mcpAttempts] = await Promise.all([
		listIssues(ctx, 100),
		getLegacyHosts(ctx),
		publishLog(ctx).count({ decision: "rejected" }),
		publishLog(ctx).count({ origin: "mcp" }),
	]);
	return {
		blocks: [
			{ type: "header", text: "Migration issues" },
			{
				type: "context",
				text: "Entries with raw WordPress shortcodes or links to the old site. Publishing is blocked until they are fixed.",
			},
			{
				type: "stats",
				items: [
					{ label: "Entries with issues", value: String(total), trend: total ? "down" : "neutral" },
					{ label: "Publishes blocked", value: String(rejected) },
					{ label: "Publish attempts via MCP", value: String(mcpAttempts) },
				],
			},
			{
				type: "form",
				block_id: "hosts",
				fields: [
					{
						type: "text_input",
						action_id: "hosts",
						label: "Legacy hosts (comma-separated)",
						initial_value: hosts.join(", "),
					},
				],
				submit: { label: "Save and rescan", action_id: "save_hosts" },
			},
			{ type: "actions", elements: [{ type: "button", label: "Rescan all content", action_id: "rescan", style: "primary" }] },
			{
				type: "table",
				columns: [
					{ key: "title", label: "Entry" },
					{ key: "collection", label: "Collection" },
					{ key: "issues", label: "Issues" },
					{ key: "scannedAt", label: "Scanned" },
				],
				rows: items.map((i) => ({
					title: i.title,
					collection: i.collection,
					issues: summarise(i),
					scannedAt: i.scannedAt.slice(0, 16).replace("T", " "),
				})),
				page_action_id: "browse_issues",
				empty_text: "No migration issues. Run a scan after importing content.",
			},
		],
		...(toast ? { toast } : {}),
	};
}

// ---------------------------------------------------------------- plugin

const plugin: SandboxedPlugin = {
	hooks: {
		"content:afterSave": async (event, ctx) => {
			const content = asRecord(event.content);
			const id = asString(content.id);
			if (!id) return;
			const data = asRecord(content.data ?? content);
			await recordScan(ctx as Ctx, event.collection, { id, slug: asString(content.slug), data }, await getLegacyHosts(ctx as Ctx));
		},

		"content:afterDelete": async (event, ctx) => {
			await issues(ctx as Ctx).delete(`${event.collection}:${event.id}`);
		},

		"content:beforePublish": async (event, ctx) => {
			const content = asRecord(event.content);
			// origin is { source, pluginId? } at runtime (the docs show a bare string)
			const origin =
				event.origin.source === "plugin" ? `plugin:${event.origin.pluginId}` : event.origin.source;
			const hosts = await getLegacyHosts(ctx as Ctx);
			const result = scanData(content.data, hosts);
			let rejected = hasIssues(result);
			let reason = rejected ? `Migration leftovers must be fixed before publishing: ${summarise(result)}.`.slice(0, 500) : null;
			if (rejected) {
				// Allow a fix on an already-published entry that keeps an unrelated leftover, as long
				// as nothing gets worse. Never-published entries stay blocked.
				const id = asString(content.id);
				// A missing or unreadable live version means "not live": stay blocked
				const live = id ? await ctx.content!.get(event.collection, id).catch(() => null) : null;
				const liveResult = live?.status === "published" ? scanData(live.data, hosts) : null;
				if (liveResult && isNoWorse(result, liveResult)) {
					rejected = false;
					reason = `Allowed: no worse than the live version (now ${summarise(result)}; live ${summarise(liveResult)}).`.slice(0, 500);
				}
			}
			const record: PublishLogRecord = {
				at: new Date().toISOString(),
				collection: event.collection,
				entryId: asString(content.id),
				slug: asString(content.slug),
				origin,
				actorId: event.actor?.id ?? null,
				decision: rejected ? "rejected" : "allowed",
				reason,
			};
			await publishLog(ctx as Ctx).put(`${record.at}:${crypto.randomUUID()}`, record);
			ctx.log.info("publish policy", { ...record });
			if (rejected) return { cancel: true, reason: reason! };
		},
	},

	routes: {
		scan: {
			permission: "content:read",
			methods: ["POST"],
			handler: async (routeCtx, ctx) => {
				const parsed = scanInput.safeParse(routeCtx.input ?? {});
				if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
				if (parsed.data.legacyHosts) await ctx.settings.set(SETTINGS_HOSTS, normaliseHosts(parsed.data.legacyHosts));
				return { ok: true, ...(await scanAll(ctx, parsed.data.collections)) };
			},
		},

		issues: {
			permission: "content:read",
			handler: async (routeCtx, ctx) => {
				const parsed = issuesInput.safeParse(routeCtx.input ?? {});
				if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
				return { ok: true, ...(await listIssues(ctx, parsed.data.limit)) };
			},
		},

		admin: {
			permission: "content:read",
			handler: async (routeCtx, ctx) => {
				const parsed = adminInput.safeParse(routeCtx.input);
				if (!parsed.success) return { blocks: [] };
				const interaction = parsed.data;
				if (interaction.type === "form_submit" && interaction.action_id === "save_hosts") {
					const hosts = normaliseHosts((interaction.values.hosts ?? "").split(","));
					await ctx.settings.set(SETTINGS_HOSTS, hosts);
					const { scanned, flagged } = await scanAll(ctx);
					return issuesPage(ctx, { type: "success", message: `Saved ${hosts.length} host(s). Scanned ${scanned}, ${flagged} with issues.` });
				}
				if (interaction.type === "block_action" && interaction.action_id === "rescan") {
					const { scanned, flagged } = await scanAll(ctx);
					return issuesPage(ctx, { type: "success", message: `Scanned ${scanned} entries, ${flagged} with issues.` });
				}
				return issuesPage(ctx);
			},
		},
	},

	mcp: {
		tools: {
			scan: {
				description:
					"Scan site content for WordPress migration leftovers: raw shortcodes ([gallery], [caption], …) and links to legacy hosts. Optionally set the legacy hostnames to flag. Updates the issue list used by the publish gate.",
				route: "scan",
				input: scanInput,
				destructive: false,
			},
			issues: {
				description:
					"List entries that still contain WordPress migration leftovers, with counts per shortcode and legacy-URL samples. Entries listed here cannot be published until fixed.",
				route: "issues",
				input: issuesInput,
				destructive: false,
			},
		},
	},
};

export default plugin;
