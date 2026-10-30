import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import { z } from "zod";

/**
 * agent-guard: AI agents can't publish on their own; an editor approves first.
 *
 * Policy (content:beforePublish): a publish whose origin is MCP and whose actor is below admin is
 * rejected and recorded as an approval request. Everything else is allowed, including the
 * plugin's own publish after an editor approves.
 *
 * Agents also can't schedule (the scheduler would publish without review) or unpublish (it takes
 * content off the site): content:beforeSchedule and content:beforeUnpublish refuse both for MCP
 * actors below admin. Trashing live content is gated in the MCP tool itself (patch F33), because the
 * delete hook event carries no actor.
 *
 * Revision fencing: the request stores the entry's `_rev` (from content.getVersioned) as seen when
 * the agent tried to publish. Approval publishes with that same `_rev`; if the draft changed since,
 * nothing is published and the request becomes "stale" (the agent must publish again, which
 * re-opens it with the new revision for re-review).
 */

const ADMIN_ROLE = 50;
const EDITOR_ROLE = 40;
const HISTORY_LIMIT = 15;

type Status = "pending" | "approved" | "rejected" | "stale";

interface RequestRecord {
	collection: string;
	entryId: string;
	slug: string | null;
	title: string;
	requestedBy: string | null;
	requestedAt: string;
	/** Number of publish attempts folded into this request */
	attempts: number;
	status: Status;
	/** Revision of the draft at request time; approval is fenced on it. null = unreadable, cannot be approved */
	rev: string | null;
	draftRevisionId: string | null;
	decidedBy: string | null;
	decidedAt: string | null;
}

interface AuditRecord {
	at: string;
	event: "policy" | "approved" | "rejected" | "stale" | "approve_failed";
	collection: string;
	entryId: string | null;
	origin: string | null;
	actorId: string | null;
	decision: string;
	reason: string | null;
}

interface Collection<T> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	query(options?: Record<string, unknown>): Promise<{ items: Array<{ id: string; data: T }> }>;
	count(where?: Record<string, unknown>): Promise<number>;
}
type Ctx = PluginContext;
const requests = (ctx: Ctx) => ctx.storage.requests as unknown as Collection<RequestRecord>;
const auditLog = (ctx: Ctx) => ctx.storage.audit_log as unknown as Collection<AuditRecord>;

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const requestKey = (collection: string, id: string) => `${collection}:${id}`;

async function audit(ctx: Ctx, record: Omit<AuditRecord, "at">) {
	const full: AuditRecord = { at: new Date().toISOString(), ...record };
	await auditLog(ctx).put(`${full.at}:${crypto.randomUUID()}`, full);
	ctx.log.info("agent-guard", { ...full });
}

const originName = (origin: { source: string; pluginId?: string }) =>
	origin.source === "plugin" ? `plugin:${origin.pluginId}` : origin.source;

/** An agent action: it came through MCP and the actor is below admin (a missing actor counts as below) */
const isAgentAction = (event: { origin: { source: string }; actor?: { role?: unknown } }) =>
	event.origin.source === "mcp" && (typeof event.actor?.role !== "number" || event.actor.role < ADMIN_ROLE);

/**
 * Policy for actions an agent may not take at all (F33): scheduling a publish would let the scheduler
 * publish without review, and unpublishing takes content off the site. Agents are told what to do instead.
 */
function refuseAgentAction(action: string, reason: string) {
	return async (event: { collection: string; content: unknown; origin: { source: string; pluginId?: string }; actor?: { id?: string; role?: unknown } }, ctx: unknown) => {
		const base = { collection: event.collection, entryId: asString(asRecord(event.content).id), origin: originName(event.origin), actorId: event.actor?.id ?? null };
		if (!isAgentAction(event)) {
			await audit(ctx as Ctx, { event: "policy", ...base, decision: "allowed", reason: action });
			return;
		}
		// "refused", not "rejected": rejected counts held publishes on the approvals page
		await audit(ctx as Ctx, { event: "policy", ...base, decision: "refused", reason: `${action}: ${reason}` });
		return { cancel: true as const, reason };
	};
}

// ---------------------------------------------------------------- decisions

type DecideResult = { ok: boolean; message: string };

async function approve(ctx: Ctx, key: string, decidedBy: string): Promise<DecideResult> {
	const req = await requests(ctx).get(key);
	if (!req) return { ok: false, message: "Request not found." };
	if (req.status !== "pending") return { ok: false, message: `Request is already ${req.status}.` };
	const content = ctx.content!;
	const fail = async (message: string, status: Status, event: AuditRecord["event"]): Promise<DecideResult> => {
		await requests(ctx).put(key, { ...req, status });
		await audit(ctx, { event, collection: req.collection, entryId: req.entryId, origin: null, actorId: decidedBy, decision: event, reason: message });
		return { ok: false, message };
	};
	const staleMessage = "The draft changed after the request. Nothing was published; ask the agent to publish again for a fresh review.";
	if (!req.rev) {
		return fail("The reviewed revision could not be recorded, so it cannot be approved. Ask the agent to publish again.", "stale", "stale");
	}
	const current = await content.getVersioned!(req.collection, req.entryId).catch(() => null);
	if (!current) return fail("The entry no longer exists.", "stale", "stale");
	if (current._rev !== req.rev) return fail(staleMessage, "stale", "stale");
	try {
		// Fenced: the host refuses (CONFLICT) if the draft moved between the check above and now
		await content.publish!(req.collection, req.entryId, { _rev: req.rev });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (/conflict|precondition/i.test(detail)) return fail(staleMessage, "stale", "stale");
		return fail(`Publish failed: ${detail}`.slice(0, 300), "pending", "approve_failed");
	}
	await requests(ctx).put(key, { ...req, status: "approved", decidedBy, decidedAt: new Date().toISOString() });
	await audit(ctx, { event: "approved", collection: req.collection, entryId: req.entryId, origin: null, actorId: decidedBy, decision: "approved", reason: `Published reviewed revision ${req.rev}` });
	return { ok: true, message: `Approved and published "${req.title}".` };
}

async function reject(ctx: Ctx, key: string, decidedBy: string): Promise<DecideResult> {
	const req = await requests(ctx).get(key);
	if (!req) return { ok: false, message: "Request not found." };
	if (req.status !== "pending" && req.status !== "stale") return { ok: false, message: `Request is already ${req.status}.` };
	await requests(ctx).put(key, { ...req, status: "rejected", decidedBy, decidedAt: new Date().toISOString() });
	await audit(ctx, { event: "rejected", collection: req.collection, entryId: req.entryId, origin: null, actorId: decidedBy, decision: "rejected", reason: "Rejected by editor; draft left as is" });
	return { ok: true, message: `Rejected "${req.title}". The draft was left as it is.` };
}

// ---------------------------------------------------------------- queries

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

async function listPending(ctx: Ctx) {
	const [pending, stale] = await Promise.all([
		requests(ctx).query({ where: { status: "pending" }, orderBy: { requestedAt: "asc" }, limit: 100 }),
		requests(ctx).query({ where: { status: "stale" }, orderBy: { requestedAt: "asc" }, limit: 100 }),
	]);
	return [...pending.items, ...stale.items].map((i) => ({ key: i.id, ...i.data }));
}

async function listHistory(ctx: Ctx) {
	const [approved, rejected] = await Promise.all([
		requests(ctx).query({ where: { status: "approved" }, orderBy: { decidedAt: "desc" }, limit: HISTORY_LIMIT }),
		requests(ctx).query({ where: { status: "rejected" }, orderBy: { decidedAt: "desc" }, limit: HISTORY_LIMIT }),
	]);
	return [...approved.items, ...rejected.items]
		.map((i) => i.data)
		.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
		.slice(0, HISTORY_LIMIT);
}

// ---------------------------------------------------------------- admin page

const adminInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({ type: z.literal("block_action"), action_id: z.string(), value: z.unknown().optional() }),
]);

async function approvalsPage(ctx: Ctx, toast?: { type: "success" | "error"; message: string }) {
	const [pending, history, held] = await Promise.all([
		listPending(ctx),
		listHistory(ctx),
		auditLog(ctx).count({ event: "policy", decision: "rejected" }),
	]);
	const blocks: Array<Record<string, unknown>> = [
		{ type: "header", text: "Agent approvals" },
		{
			type: "context",
			text: "Publishes requested by AI agents (MCP) wait here until an editor approves them. Approving publishes exactly the version that was requested.",
		},
		{
			type: "stats",
			items: [
				{ label: "Waiting for approval", value: String(pending.filter((p) => p.status === "pending").length) },
				{ label: "Agent publishes held", value: String(held) },
			],
		},
	];
	if (!pending.length) blocks.push({ type: "banner", description: "Nothing is waiting for approval." });
	for (const p of pending) {
		blocks.push({ type: "divider" });
		blocks.push({
			type: "section",
			text: `**${p.title}** (${p.collection}) requested by ${p.requestedBy ?? "unknown"} at ${when(p.requestedAt)}${p.attempts > 1 ? `, ${p.attempts} attempts` : ""}${p.status === "stale" ? "\nThe draft changed after this request, so it cannot be approved. Ask the agent to publish again, or reject it." : ""}`,
		});
		blocks.push({
			type: "actions",
			elements: [
				...(p.status === "pending" ? [{ type: "button", label: "Approve and publish", action_id: "approve", style: "primary", value: p.key }] : []),
				{ type: "button", label: "Reject", action_id: "reject", style: "danger", value: p.key },
			],
		});
	}
	blocks.push({ type: "divider" });
	blocks.push({
		type: "table",
		columns: [
			{ key: "title", label: "Recent decisions" },
			{ key: "collection", label: "Collection" },
			{ key: "status", label: "Decision" },
			{ key: "requestedBy", label: "Requested by" },
			{ key: "decidedBy", label: "Decided by" },
			{ key: "decidedAt", label: "When" },
		],
		rows: history.map((h) => ({ ...h, decidedAt: when(h.decidedAt) })),
		page_action_id: "browse_history",
		empty_text: "No decisions yet.",
	});
	return { blocks, ...(toast ? { toast } : {}) };
}

// ---------------------------------------------------------------- plugin

const plugin: SandboxedPlugin = {
	hooks: {
		"content:beforePublish": async (event, ctx) => {
			const c = ctx as Ctx;
			const content = asRecord(event.content);
			const entryId = asString(content.id);
			const held = isAgentAction(event);
			const slug = asString(content.slug);
			const base = { collection: event.collection, entryId, origin: originName(event.origin), actorId: event.actor?.id ?? null };

			if (!held) {
				await audit(c, { event: "policy", ...base, decision: "allowed", reason: null });
				return;
			}
			if (!entryId) {
				// Cannot track an entry without an id: fail closed
				const reason = "Agent changes need an editor's approval, but this entry could not be identified.";
				await audit(c, { event: "policy", ...base, decision: "rejected", reason });
				return { cancel: true, reason };
			}

			const key = requestKey(event.collection, entryId);
			const versioned = await c.content!.getVersioned!(event.collection, entryId).catch(() => null);
			const existing = await requests(c).get(key);
			const open = existing?.status === "pending" || existing?.status === "stale";
			const data = asRecord(content.data);
			// One request per entry: a re-request refreshes the revision and goes back to pending
			await requests(c).put(key, {
				collection: event.collection,
				entryId,
				slug,
				title: asString(data.title) ?? slug ?? entryId,
				requestedBy: event.actor?.id ?? null,
				requestedAt: new Date().toISOString(),
				attempts: open ? existing.attempts + 1 : 1,
				status: "pending",
				rev: versioned?._rev ?? null,
				draftRevisionId: versioned?.item.draftRevisionId ?? null,
				decidedBy: null,
				decidedAt: null,
			});
			const reason = "Agent changes need an editor's approval; a request has been created.";
			await audit(c, { event: "policy", ...base, decision: "rejected", reason });
			return { cancel: true, reason };
		},
		"content:beforeSchedule": refuseAgentAction(
			"schedule",
			"Agents can't schedule publishing, because a scheduled publish goes live without review. Use content_publish instead: it asks an editor to approve.",
		),
		"content:beforeUnpublish": refuseAgentAction(
			"unpublish",
			"Agents can't take content off the site. Ask an editor to unpublish it.",
		),
	},

	routes: {
		requests: {
			permission: "content:read",
			handler: async (_routeCtx, ctx) => {
				const pending = await listPending(ctx);
				return {
					ok: true,
					items: pending.map((p) => ({
						collection: p.collection,
						entryId: p.entryId,
						slug: p.slug,
						title: p.title,
						requestedAt: p.requestedAt,
						status: p.status,
					})),
				};
			},
		},

		admin: {
			// Editors and up; re-checked below against the authenticated user
			permission: "content:publish_any",
			handler: async (routeCtx, ctx) => {
				const parsed = adminInput.safeParse(routeCtx.input);
				if (!parsed.success) return { blocks: [] };
				const interaction = parsed.data;
				if (interaction.type === "block_action" && (interaction.action_id === "approve" || interaction.action_id === "reject")) {
					const user = routeCtx.user;
					if (!user || user.role < EDITOR_ROLE || typeof interaction.value !== "string") {
						return approvalsPage(ctx, { type: "error", message: "Only a signed-in editor can decide approvals." });
					}
					const result =
						interaction.action_id === "approve" ? await approve(ctx, interaction.value, user.id) : await reject(ctx, interaction.value, user.id);
					return approvalsPage(ctx, { type: result.ok ? "success" : "error", message: result.message });
				}
				return approvalsPage(ctx);
			},
		},
	},

	// Read-only. There is deliberately no approve/reject tool: agents cannot approve.
	mcp: {
		tools: {
			requests: {
				description: "List publish requests waiting for an editor's approval. Read-only; an editor approves in the admin UI.",
				route: "requests",
				input: z.object({}),
				destructive: false,
			},
		},
	},
};

export default plugin;
