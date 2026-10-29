/**
 * Pass: forms, part 2 of 2 (after import, before shortcodes). See `forms.ts` for part 1.
 *
 * Creates each form with the forms plugin (`@emdash-cms/plugin-forms`, route `forms/create`).
 * A form whose slug already exists is left as it is, so a re-run never overwrites an editor's
 * changes. Returns slug → form ID for the shortcodes pass, which embeds the forms.
 */

import type { FormSpec } from "./forms.ts";
import type { RestClient } from "./rest-client.ts";

export const FORMS_PLUGIN_ROUTES = "/plugins/emdash-forms";

export interface FixFormsOptions {
	forms: FormSpec[];
	rest: RestClient;
	dryRun?: boolean;
	log?: (line: string) => void;
}

export interface FormsReport {
	created: { slug: string; id: string }[];
	existing: { slug: string; id: string }[];
	failed: { slug: string; error: string }[];
	/** What an editor should check, per form */
	toReview: { slug: string; name: string; notes: string[] }[];
	/** slug → form ID */
	ids: Record<string, string>;
}

export async function fixForms(options: FixFormsOptions): Promise<FormsReport> {
	const { rest, dryRun, log = () => {} } = options;
	const report: FormsReport = { created: [], existing: [], failed: [], toReview: [], ids: {} };
	if (!options.forms.length) return report;

	const existing = new Map<string, string>();
	try {
		const list = await rest.post<{ items: { id: string; slug: string }[] }>(`${FORMS_PLUGIN_ROUTES}/forms/list`, {});
		for (const f of list.items ?? []) existing.set(f.slug, f.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`the forms plugin isn't reachable (is @emdash-cms/plugin-forms installed?): ${message}`);
	}

	for (const form of options.forms) {
		if (form.notes.length) report.toReview.push({ slug: form.slug, name: form.name, notes: form.notes });
		const id = existing.get(form.slug);
		if (id) {
			report.existing.push({ slug: form.slug, id });
			report.ids[form.slug] = id;
			log(`${form.slug}: already exists, left unchanged`);
			continue;
		}
		if (dryRun) {
			log(`${form.slug}: would create (${form.pages[0].fields.length} fields)`);
			continue;
		}
		try {
			const created = await rest.post<{ id: string }>(`${FORMS_PLUGIN_ROUTES}/forms/create`, {
				name: form.name,
				slug: form.slug,
				pages: form.pages,
				settings: form.settings,
			});
			report.created.push({ slug: form.slug, id: created.id });
			report.ids[form.slug] = created.id;
			log(`${form.slug}: created`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			report.failed.push({ slug: form.slug, error: message });
			log(`${form.slug}: FAILED ${message}`);
		}
	}
	return report;
}
