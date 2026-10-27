/**
 * Pass: baseline revisions (last, after all other passes). SPEC §5.2, spike F15.
 *
 * EmDash's importer writes no revisions, so the first edit to a migrated entry (by an
 * agent or an editor) can't be undone: `revision_list` is empty and the migrated version
 * is gone. For every entry without any revision, we save it unchanged, which makes EmDash
 * snapshot the full entry as a revision, and re-publish published entries so the snapshot
 * becomes the live revision. Publish dates are preserved by EmDash; scheduled entries are
 * never published (that would make them go live early); entries with history are skipped.
 */

import { listCollections, listEntryIds } from "./entries.ts";
import type { McpClient } from "./mcp-client.ts";

export interface BaselineOutcome {
	collection: string;
	slug: string;
	status: string;
	revisionId?: string;
	published: boolean;
	error?: string;
}

export interface BaselineReport {
	created: BaselineOutcome[];
	alreadyHadHistory: number;
	/**
	 * Snapshot saved as a draft revision, but re-publishing was refused by a publish policy
	 * (e.g. migration-guard found leftovers). History exists; the go-live check reports why.
	 */
	blocked: BaselineOutcome[];
	failed: BaselineOutcome[];
}

/** The field to re-save unchanged: `title` when present, else the first scalar field. */
export function pickUnchangedField(data: Record<string, unknown>): [string, unknown] | undefined {
	if (typeof data.title === "string") return ["title", data.title];
	return Object.entries(data).find(([, v]) => v === null || typeof v !== "object");
}

export function needsBaseline(item: { liveRevisionId?: string | null; draftRevisionId?: string | null }, revisionCount: number): boolean {
	return !item.liveRevisionId && !item.draftRevisionId && revisionCount === 0;
}

export async function createBaselineRevisions(options: { mcp: McpClient; dryRun?: boolean; log?: (line: string) => void }): Promise<BaselineReport> {
	const { mcp, dryRun, log = () => {} } = options;
	const report: BaselineReport = { created: [], alreadyHadHistory: 0, blocked: [], failed: [] };

	for (const { slug: collection } of await listCollections(mcp)) {
		for (const id of await listEntryIds(mcp, collection)) {
			const { item, _rev } = await mcp.call("content_get", { collection, id });
			const revisions = await mcp.call("revision_list", { collection, id: item.id, limit: 1 });
			if (!needsBaseline(item, (revisions?.items ?? revisions ?? []).length)) {
				report.alreadyHadHistory++;
				continue;
			}
			const outcome: BaselineOutcome = { collection, slug: item.slug ?? item.id, status: item.status, published: false };
			const field = pickUnchangedField(item.data ?? {});
			if (!field) {
				report.failed.push({ ...outcome, error: "no scalar field to re-save" });
				continue;
			}
			if (dryRun) {
				report.created.push(outcome);
				continue;
			}
			try {
				await mcp.call("content_update", { collection, id: item.id, _rev, data: { [field[0]]: field[1] } });
				let fresh = await mcp.call("content_get", { collection, id: item.id });
				if (item.status === "published") {
					await mcp.call("content_publish", { collection, id: item.id, _rev: fresh._rev });
					fresh = await mcp.call("content_get", { collection, id: item.id });
					outcome.published = true;
				}
				outcome.revisionId = fresh.item.liveRevisionId ?? fresh.item.draftRevisionId ?? undefined;
				if (fresh.item.status !== item.status) throw new Error(`status changed from ${item.status} to ${fresh.item.status}`);
				if (!outcome.revisionId) throw new Error("no revision was created");
				report.created.push(outcome);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("PUBLISH_REJECTED")) {
					report.blocked.push({ ...outcome, error: message });
					log(`${collection}/${outcome.slug}: snapshot saved; re-publish blocked by policy`);
				} else {
					report.failed.push({ ...outcome, error: message });
					log(`${collection}/${outcome.slug}: FAILED ${message}`);
				}
			}
		}
	}
	log(
		`baseline revisions: ${report.created.length} created, ${report.blocked.length} saved but publish blocked, ` +
			`${report.alreadyHadHistory} already had history, ${report.failed.length} failed`,
	);
	return report;
}
