/**
 * Pass: forms, part 1 of 2 (before import). Spike F23, F28.
 *
 * WordPress form plugins keep their forms as posts (`wpcf7_contact_form` for Contact Form 7,
 * `wpforms` for WPForms) and place them with shortcodes. EmDash's forms plugin
 * (`@emdash-cms/plugin-forms`) has its own form store and an `emdash-form` block, so:
 *   - `readForms` converts each form post into the plugin's create input;
 *   - the shortcodes pass turns `[contact-form-7 …]`, `[contact-form …]` (old Contact Form 7, or
 *     Jetpack's, which carries its fields inline) and `[wpforms …]` into markers that become
 *     `emdash-form` blocks after import (`fix-shortcodes.ts`);
 *   - a shortcode whose form isn't in the export (exports of pages only leave forms out) gets a
 *     standard contact form, marked for review, so the page still works;
 *   - `fixForms` (part 2) creates the forms through the plugin's admin routes.
 * Form posts are removed from the prepared WXR, so the importer doesn't treat them as content.
 *
 * Every field the conversion can't carry over is listed in the form's `notes` for an editor.
 */

import { findShortcodes, type ShortcodeMatch } from "./shortcode-parse.ts";
import { getField, readItems, readMeta, replaceItems } from "./wxr.ts";

export const FORM_POST_TYPES = ["wpcf7_contact_form", "wpforms"];
export const FORM_SHORTCODES = ["contact-form-7", "contact-form", "wpforms"];

/** The plugin's field types (`fieldTypeSchema`) */
export type FieldType =
	| "text"
	| "email"
	| "textarea"
	| "number"
	| "tel"
	| "url"
	| "date"
	| "select"
	| "radio"
	| "checkbox"
	| "checkbox-group"
	| "file"
	| "hidden";

export interface FormField {
	id: string;
	type: FieldType;
	label: string;
	name: string;
	placeholder?: string;
	helpText?: string;
	required: boolean;
	options?: { label: string; value: string }[];
	defaultValue?: string;
	validation?: { minLength?: number; maxLength?: number; min?: number; max?: number; accept?: string; maxFileSize?: number };
}

export interface FormSpec {
	/** The plugin's form slug; also what the migrated blocks point at until the form has an ID */
	slug: string;
	name: string;
	source: "contact-form-7" | "wpforms" | "jetpack" | "standard";
	wpId?: number;
	/** Contact Form 7 5.8+ shortcodes name a form by the first 7 characters of its hash */
	hash?: string;
	pages: { fields: FormField[] }[];
	settings: { confirmationMessage?: string; notifyEmails: string[]; submitLabel: string; spamProtection: "honeypot" };
	/** What an editor should check: dropped fields, missing recipients, a stand-in form */
	notes: string[];
}

export interface FormCatalog {
	forms: FormSpec[];
	/** The form a shortcode embeds; adds a standard form when the export doesn't have it */
	resolve(match: ShortcodeMatch): FormSpec;
}

export function readForms(xml: string): FormCatalog {
	const forms: FormSpec[] = [];
	const slugs = new Set<string>();
	const uniqueSlug = (title: string) => {
		const base = toFormSlug(title);
		let slug = base;
		for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
		slugs.add(slug);
		return slug;
	};

	for (const { raw } of readItems(xml)) {
		const type = getField(raw, "wp:post_type");
		if (!FORM_POST_TYPES.includes(type)) continue;
		const wpId = Number(getField(raw, "wp:post_id"));
		const title = decodeEntities(getField(raw, "title")) || `Form ${wpId}`;
		const meta = readMeta(raw);
		const converted = type === "wpcf7_contact_form" ? convertCf7(meta) : convertWpforms(getField(raw, "content:encoded"));
		forms.push({
			slug: uniqueSlug(title),
			name: title,
			source: type === "wpcf7_contact_form" ? "contact-form-7" : "wpforms",
			wpId,
			hash: meta.get("_hash") || undefined,
			...converted,
		});
	}

	const byShortcode = new Map<string, FormSpec>();
	const resolve = (match: ShortcodeMatch): FormSpec => {
		const known = byShortcode.get(match.raw);
		if (known) return known;
		const form = findForm(match) ?? inlineForm(match) ?? standardForm(match);
		byShortcode.set(match.raw, form);
		return form;
	};

	const findForm = (match: ShortcodeMatch): FormSpec | undefined => {
		const { attrs } = match;
		const ref = attrs.id ?? attrs["0"] ?? "";
		const title = shortcodeTitle(match);
		const source = match.name === "wpforms" ? "wpforms" : "contact-form-7";
		return (
			forms.find((f) => f.source === source && f.wpId !== undefined && String(f.wpId) === ref) ??
			forms.find((f) => f.source === source && ref.length >= 7 && f.hash?.startsWith(ref)) ??
			(title ? forms.find((f) => f.source === source && f.name === title) : undefined)
		);
	};

	/** Jetpack's `[contact-form][contact-field …/][/contact-form]` carries its whole definition */
	const inlineForm = (match: ShortcodeMatch): FormSpec | undefined => {
		if (match.name !== "contact-form" || !match.content?.includes("[contact-field")) return undefined;
		const name = match.attrs.subject ? decodeEntities(match.attrs.subject) : "Contact form";
		const form: FormSpec = { slug: uniqueSlug(name), name, source: "jetpack", ...convertJetpack(match) };
		forms.push(form);
		return form;
	};

	const standardForm = (match: ShortcodeMatch): FormSpec => {
		const ref = match.attrs.id ?? match.attrs["0"] ?? "";
		const name = shortcodeTitle(match) || `Contact form ${ref}`.trim();
		const form: FormSpec = {
			slug: uniqueSlug(name),
			name,
			source: "standard",
			pages: [
				{
					fields: [
						{ id: "name", type: "text", label: "Name", name: "name", required: true },
						{ id: "email", type: "email", label: "Email", name: "email", required: true },
						{ id: "message", type: "textarea", label: "Message", name: "message", required: true },
					],
				},
			],
			settings: { notifyEmails: [], submitLabel: "Send", spamProtection: "honeypot" },
			notes: [
				`the export doesn't include this form (${match.raw}), so a standard contact form (name, email, message) stands in: compare it with the live site`,
				"set who receives submissions (notifications)",
			],
		};
		forms.push(form);
		return form;
	};

	return { forms, resolve };
}

/** The export without its form posts */
export function removeFormItems(xml: string): string {
	const items = readItems(xml);
	const removed = new Map<number, string>();
	items.forEach(({ raw }, index) => {
		if (FORM_POST_TYPES.includes(getField(raw, "wp:post_type"))) removed.set(index, "");
	});
	return removed.size ? replaceItems(xml, items, removed) : xml;
}

// ─── Contact Form 7 ─────────────────────────────────────────────

const CF7_TYPE: Record<string, FieldType> = {
	text: "text",
	email: "email",
	url: "url",
	tel: "tel",
	number: "number",
	range: "number",
	date: "date",
	textarea: "textarea",
	select: "select",
	radio: "radio",
	checkbox: "checkbox-group",
	acceptance: "checkbox",
	file: "file",
	hidden: "hidden",
};
const CF7_DROPPED = new Set(["quiz", "captchac", "captchar", "recaptcha", "really_simple_captcha", "count"]);
const CF7_TAG = /\[(\w+)(\*?)(?:\s+([^\]]*?))?\](?:([^[]*)\[\/\1\])?/g;

export function convertCf7(meta: Map<string, string>): Omit<FormSpec, "slug" | "name" | "source" | "wpId" | "hash"> {
	const template = meta.get("_form") ?? "";
	const fields: FormField[] = [];
	const notes: string[] = [];
	const names = new Set<string>();
	let submitLabel = "Send";
	let previousEnd = 0;

	for (const m of template.matchAll(CF7_TAG)) {
		const [raw, tagType, star, body = "", enclosed] = m;
		const textBefore = template.slice(previousEnd, m.index);
		previousEnd = m.index + raw.length;
		const { name, options, values } = parseCf7Tag(tagType === "submit" ? `_ ${body}` : body);

		if (tagType === "submit") {
			submitLabel = values[0] || submitLabel;
			continue;
		}
		if (CF7_DROPPED.has(tagType)) {
			notes.push(`dropped [${tagType}${name ? ` ${name}` : ""}]: spam is handled by the plugin's honeypot`);
			continue;
		}
		let type = CF7_TYPE[tagType];
		if (!type || !name) {
			notes.push(`dropped unsupported field ${raw.slice(0, 60)}`);
			continue;
		}

		const field: FormField = {
			id: "",
			type,
			label: "",
			name: uniqueName(name, names),
			required: star === "*" || (tagType === "acceptance" && !options.includes("optional")),
		};
		const label = labelFor(template, m.index, raw.length, textBefore);
		const choices = values.map((v) => {
			const [l, value] = v.split("|");
			return { label: l, value: value ?? l };
		});

		if (type === "select" || type === "radio" || type === "checkbox-group") {
			if (type === "select" && options.includes("multiple")) type = "checkbox-group";
			if (type === "checkbox-group" && choices.length === 1) {
				type = "checkbox";
				field.label = choices[0].label;
			} else {
				field.options = options.includes("first_as_label") && type === "select" ? choices.slice(1) : choices;
				if (options.includes("first_as_label") && choices[0]) field.placeholder = choices[0].label;
			}
			field.type = type;
			if (field.options && !field.options.length) {
				notes.push(`dropped "${name}": no choices`);
				continue;
			}
		} else if (tagType === "acceptance") {
			field.label = htmlToText(enclosed ?? "") || label;
		} else if (options.includes("placeholder") || options.includes("watermark")) {
			field.placeholder = values[0];
		} else if (values[0]) {
			field.defaultValue = values[0];
		}

		const validation: NonNullable<FormField["validation"]> = {};
		for (const option of options) {
			const [key, value] = option.split(":");
			const n = Number(value);
			if (key === "minlength" && n >= 0) validation.minLength = n;
			if (key === "maxlength" && n >= 1) validation.maxLength = n;
			if (key === "min" && Number.isFinite(n)) validation.min = n;
			if (key === "max" && Number.isFinite(n)) validation.max = n;
			if (key === "filetypes") validation.accept = value.split("|").map((t) => `.${t.replace(/^\./, "")}`).join(",");
			if (key === "limit") validation.maxFileSize = parseSize(value);
		}
		if (Object.keys(validation).length) field.validation = validation;

		field.label ||= label || humanise(name);
		field.id = field.name;
		fields.push(field);
	}

	const mail = meta.get("_mail") ?? "";
	const recipient = serializedString(mail, "recipient") ?? "";
	const notifyEmails = [...recipient.matchAll(/[^\s,;<>"[\]]+@[^\s,;<>"[\]]+\.[a-z]{2,}/gi)].map((r) => r[0]);
	if (!notifyEmails.length) notes.push(`set who receives submissions (Contact Form 7 sent them to ${recipient || "nobody"})`);
	if (!fields.length) notes.push("the form had no fields that could be converted");

	return {
		pages: [{ fields: fields.length ? fields : [{ id: "message", type: "textarea", label: "Message", name: "message", required: true }] }],
		settings: {
			confirmationMessage: serializedString(meta.get("_messages") ?? "", "mail_sent_ok") || undefined,
			notifyEmails,
			submitLabel,
			spamProtection: "honeypot",
		},
		notes,
	};
}

/** `your-name placeholder "Your name" minlength:2` → name, bare options, quoted values */
function parseCf7Tag(body: string): { name: string; options: string[]; values: string[] } {
	const values = [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((v) => v[1] ?? v[2]);
	const bare = body.replace(/"[^"]*"|'[^']*'/g, " ").split(/\s+/).filter(Boolean);
	return { name: bare[0] ?? "", options: bare.slice(1), values };
}

/** The `<label>` around the tag, else the text just before it on its line. */
function labelFor(template: string, start: number, length: number, textBefore: string): string {
	const open = template.lastIndexOf("<label", start);
	const closeBefore = template.lastIndexOf("</label>", start);
	if (open !== -1 && open > closeBefore) {
		const inside = template.slice(template.indexOf(">", open) + 1, start);
		const after = template.slice(start + length, template.indexOf("</label>", start));
		return cleanLabel(htmlToText(inside) || htmlToText(after));
	}
	const lines = textBefore.split(/<br\s*\/?>|<\/p>|<\/div>|\n/i).map(htmlToText).filter(Boolean);
	return cleanLabel(lines.at(-1) ?? "");
}

function cleanLabel(text: string): string {
	return text.replace(/\s*\(\s*(?:required|optional)\s*\)\s*$/i, "").replace(/\s*\*\s*$/, "").trim();
}

/** The value of `s:N:"<key>";s:N:"<value>";` in a PHP-serialized array */
function serializedString(serialized: string, key: string): string | undefined {
	const m = serialized.match(new RegExp(`s:\\d+:"${key}";s:\\d+:"([\\s\\S]*?)";`));
	return m ? decodeEntities(m[1]).trim() : undefined;
}

function parseSize(value: string): number | undefined {
	const m = value.toLowerCase().match(/^(\d+)(kb|mb)?$/);
	if (!m) return undefined;
	return Number(m[1]) * (m[2] === "mb" ? 1024 * 1024 : m[2] === "kb" ? 1024 : 1);
}

function shortcodeTitle(match: ShortcodeMatch): string {
	const title = decodeEntities(match.attrs.title ?? (match.name === "contact-form" ? match.attrs["1"] ?? "" : "")).trim();
	return title === "false" ? "" : title;
}

// ─── Jetpack ────────────────────────────────────────────────────

const JETPACK_TYPE: Record<string, FieldType> = {
	name: "text",
	text: "text",
	email: "email",
	url: "url",
	telephone: "tel",
	date: "date",
	textarea: "textarea",
	checkbox: "checkbox",
	consent: "checkbox",
	"checkbox-multiple": "checkbox-group",
	radio: "radio",
	select: "select",
};

export function convertJetpack(match: ShortcodeMatch): Omit<FormSpec, "slug" | "name" | "source" | "wpId" | "hash"> {
	const notes: string[] = [];
	const fields: FormField[] = [];
	const names = new Set<string>();
	for (const f of findShortcodes(match.content ?? "", ["contact-field"])) {
		const label = decodeEntities(f.attrs.label ?? "").trim();
		const type = JETPACK_TYPE[f.attrs.type ?? "text"];
		if (!type) {
			notes.push(`dropped unsupported field "${label || f.attrs.type}" (${f.attrs.type})`);
			continue;
		}
		const field: FormField = {
			id: "",
			type,
			label: label || humanise(f.attrs.type ?? "field"),
			name: uniqueName(label || f.attrs.type || "field", names),
			required: f.attrs.required === "1" || f.attrs.required === "true" || f.attrs.type === "consent",
		};
		const options = (f.attrs.options ?? "").split(",").map((o) => decodeEntities(o).trim()).filter(Boolean);
		if (type === "select" || type === "radio" || type === "checkbox-group") {
			if (!options.length) {
				notes.push(`dropped "${field.label}": no choices`);
				continue;
			}
			field.options = options.map((o) => ({ label: o, value: o }));
		}
		if (f.attrs.placeholder) field.placeholder = decodeEntities(f.attrs.placeholder);
		field.id = field.name;
		fields.push(field);
	}
	const notifyEmails = [...(match.attrs.to ?? "").matchAll(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/gi)].map((r) => r[0]);
	if (!notifyEmails.length) notes.push("set who receives submissions (Jetpack sent them to the site admin)");
	return {
		pages: [{ fields: fields.length ? fields : [{ id: "message", type: "textarea", label: "Message", name: "message", required: true }] }],
		settings: { notifyEmails, submitLabel: decodeEntities(match.attrs.submit_button_text ?? "") || "Submit", spamProtection: "honeypot" },
		notes,
	};
}

// ─── WPForms ────────────────────────────────────────────────────

const WPFORMS_TYPE: Record<string, FieldType> = {
	name: "text",
	text: "text",
	textarea: "textarea",
	email: "email",
	phone: "tel",
	url: "url",
	number: "number",
	"number-slider": "number",
	select: "select",
	radio: "radio",
	checkbox: "checkbox-group",
	"gdpr-checkbox": "checkbox",
	"date-time": "date",
	"file-upload": "file",
	hidden: "hidden",
};
const WPFORMS_LAYOUT = new Set(["html", "divider", "pagebreak", "content", "entry-preview", "layout"]);

export function convertWpforms(json: string): Omit<FormSpec, "slug" | "name" | "source" | "wpId" | "hash"> {
	const notes: string[] = [];
	let data: any;
	try {
		data = JSON.parse(json);
	} catch {
		data = {};
		notes.push("the WPForms definition couldn't be read; a message field stands in");
	}
	const fields: FormField[] = [];
	const names = new Set<string>();
	for (const f of Object.values<any>(data.fields ?? {})) {
		const label = htmlToText(String(f.label ?? ""));
		if (WPFORMS_LAYOUT.has(f.type)) {
			if (f.type === "pagebreak") notes.push("a multi-page form became one page");
			continue;
		}
		if (f.type === "captcha" || f.type === "captcha_recaptcha") {
			notes.push("dropped the captcha: spam is handled by the plugin's honeypot");
			continue;
		}
		let type = WPFORMS_TYPE[f.type];
		if (!type) {
			notes.push(`dropped unsupported field "${label || f.type}" (${f.type})`);
			continue;
		}
		const choices = Object.values<any>(f.choices ?? {})
			.map((c) => ({ label: htmlToText(String(c.label ?? "")), value: String(c.value || c.label || "") }))
			.filter((c) => c.label && c.value);
		if (type === "select" && f.multiple === "1") type = "checkbox-group";
		const field: FormField = {
			id: "",
			type,
			label: label || humanise(f.type),
			name: uniqueName(label || f.type, names),
			required: f.required === "1" || f.type === "gdpr-checkbox",
		};
		if (type === "checkbox-group" && choices.length === 1) {
			field.type = "checkbox";
			field.label = choices[0].label;
		} else if (type === "select" || type === "radio" || type === "checkbox-group") {
			if (!choices.length) {
				notes.push(`dropped "${field.label}": no choices`);
				continue;
			}
			field.options = choices;
		}
		if (f.type === "gdpr-checkbox" && choices[0]) field.label = choices[0].label;
		if (f.placeholder) field.placeholder = String(f.placeholder);
		if (f.description) field.helpText = htmlToText(String(f.description));
		if (f.default_value && type !== "checkbox") field.defaultValue = String(f.default_value);
		if (f.type === "name" && f.format && f.format !== "simple") notes.push(`"${field.label}" had separate first and last name boxes; it's one field now`);
		field.id = field.name;
		fields.push(field);
	}

	const settings = data.settings ?? {};
	const notification = Object.values<any>(settings.notifications ?? {})[0];
	const recipient = String(notification?.email ?? "");
	const notifyEmails = [...recipient.matchAll(/[^\s,;<>"{}]+@[^\s,;<>"{}]+\.[a-z]{2,}/gi)].map((r) => r[0]);
	if (!notifyEmails.length) notes.push(`set who receives submissions (WPForms sent them to ${recipient || "nobody"})`);
	const confirmation = Object.values<any>(settings.confirmations ?? {})[0];
	if (confirmation?.type === "redirect" || confirmation?.type === "page") notes.push("the form redirected after submitting; it shows a message now");

	return {
		pages: [{ fields: fields.length ? fields : [{ id: "message", type: "textarea", label: "Message", name: "message", required: true }] }],
		settings: {
			confirmationMessage: htmlToText(String(confirmation?.message ?? "")) || undefined,
			notifyEmails,
			submitLabel: htmlToText(String(settings.submit_text ?? "")) || "Submit",
			spamProtection: "honeypot",
		},
		notes,
	};
}

// ─── Helpers ────────────────────────────────────────────────────

/** The plugin's slug rule: `^[a-z][a-z0-9-]*$`, at most 100 characters */
export function toFormSlug(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90);
	return /^[a-z]/.test(slug) ? slug : `form-${slug || "untitled"}`;
}

/** The plugin's field-name rule: `^[a-zA-Z][a-zA-Z0-9_-]*$`, unique per form */
function uniqueName(raw: string, taken: Set<string>): string {
	let base = raw
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^[^a-zA-Z]+|_+$/g, "")
		.slice(0, 60)
		.toLowerCase();
	if (!base) base = "field";
	let name = base;
	for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
	taken.add(name);
	return name;
}

function humanise(name: string): string {
	const text = name.replace(/^your[-_]/, "").replace(/[-_]+/g, " ").trim();
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function htmlToText(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&#039;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}
