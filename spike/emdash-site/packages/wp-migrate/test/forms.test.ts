import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBlocks } from "../src/blocks.ts";
import { fixForms } from "../src/fix-forms.ts";
import { readForms, toFormSlug, type FormSpec } from "../src/forms.ts";
import { describePrepared, prepareExport } from "../src/prepare.ts";
import type { RestClient } from "../src/rest-client.ts";

const cf7Form = `<label> Your name
    [text* your-name autocomplete:name] </label>

<label> Your email
    [email* your-email autocomplete:email] </label>

<label> Phone
    [tel phone placeholder "Your phone number"] </label>

<label> Service
    [select* service first_as_label "Choose one" "Wills" "Probate|probate"] </label>

[checkbox newsletter "Send me news"]

<label> Your message (optional)
    [textarea your-message maxlength:2000] </label>

<label> CV [file cv limit:2mb filetypes:pdf|doc] </label>

[acceptance terms] I agree to the <a href="/terms">terms</a> [/acceptance]

<p>What is 1+1? [quiz q "1+1?|2"]</p>

[submit "Send enquiry"]`;

const mail = 'a:3:{s:7:"subject";s:22:"[_site_title] "[x]"";s:6:"sender";s:12:"wp@site.test";s:9:"recipient";s:21:"office@client.example";}';
const messages = 'a:2:{s:12:"mail_sent_ok";s:34:"Thank you, we will be in touch.";s:12:"mail_sent_ng";s:5:"Oops.";}';

const wpforms = JSON.stringify({
	fields: {
		"0": { id: "0", type: "name", label: "Name", format: "first-last", required: "1" },
		"1": { id: "1", type: "email", label: "Email", required: "1" },
		"2": { id: "2", type: "radio", label: "Contact me by", choices: { "1": { label: "Phone" }, "2": { label: "Email" } } },
		"3": { id: "3", type: "html", label: "" },
		"4": { id: "4", type: "captcha" },
		"5": { id: "5", type: "payment-single", label: "Deposit" },
	},
	settings: {
		form_title: "Quick enquiry",
		submit_text: "Go",
		notifications: { "1": { email: "{admin_email}" } },
		confirmations: { "1": { type: "message", message: "<p>Thanks!</p>" } },
	},
});

const meta = (key: string, value: string) => `<wp:postmeta><wp:meta_key><![CDATA[${key}]]></wp:meta_key><wp:meta_value><![CDATA[${value}]]></wp:meta_value></wp:postmeta>`;

const page = (id: number, slug: string, content: string) => `<item>
<title>${slug}</title>
<content:encoded><![CDATA[${content}]]></content:encoded>
<wp:post_id>${id}</wp:post_id>
<wp:post_name>${slug}</wp:post_name>
<wp:post_type>page</wp:post_type>
<wp:status>publish</wp:status>
</item>`;

const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss><channel>
<link>https://client.example</link>
<wp:base_blog_url>https://client.example</wp:base_blog_url>
<item>
<title>Contact form 1</title>
<content:encoded><![CDATA[${cf7Form}]]></content:encoded>
<wp:post_id>12</wp:post_id>
<wp:post_name>contact-form-1</wp:post_name>
<wp:post_type>wpcf7_contact_form</wp:post_type>
<wp:status>publish</wp:status>
${meta("_form", cf7Form)}
${meta("_mail", mail)}
${meta("_messages", messages)}
${meta("_hash", "a1b2c3d4e5f6")}
</item>
<item>
<title>Quick enquiry</title>
<content:encoded><![CDATA[${wpforms}]]></content:encoded>
<wp:post_id>20</wp:post_id>
<wp:post_name>quick-enquiry</wp:post_name>
<wp:post_type>wpforms</wp:post_type>
<wp:status>publish</wp:status>
</item>
${page(1, "contact", 'Get in touch: [contact-form-7 id="a1b2c3d" title="Contact form 1"]')}
${page(2, "home", '[contact-form-7 id="12"] and [wpforms id="20" title="false"]')}
${page(3, "quote", '[contact-form-7 id="999" title="Quote request"] again [contact-form-7 id="999" title="Quote request"]')}
${page(4, "jetpack", '[contact-form to="team@client.example" subject="Say hello"][contact-field label="Name" type="name" required="1"/][contact-field label="Topic" type="select" options="Sales,Support"/][/contact-form]')}
</channel></rss>`;

test("Contact Form 7: fields, labels, choices, validation, recipients and messages", () => {
	const [form] = readForms(xml).forms;
	assert.equal(form.slug, "contact-form-1");
	assert.equal(form.source, "contact-form-7");
	const fields = form.pages[0].fields;
	assert.deepEqual(
		fields.map((f) => [f.name, f.type, f.label, f.required]),
		[
			["your-name", "text", "Your name", true],
			["your-email", "email", "Your email", true],
			["phone", "tel", "Phone", false],
			["service", "select", "Service", true],
			["newsletter", "checkbox", "Send me news", false],
			["your-message", "textarea", "Your message", false],
			["cv", "file", "CV", false],
			["terms", "checkbox", "I agree to the terms", true],
		],
	);
	assert.equal(fields[2].placeholder, "Your phone number");
	assert.deepEqual(fields[3].options, [
		{ label: "Wills", value: "Wills" },
		{ label: "Probate", value: "probate" },
	]);
	assert.equal(fields[3].placeholder, "Choose one");
	assert.deepEqual(fields[5].validation, { maxLength: 2000 });
	assert.deepEqual(fields[6].validation, { maxFileSize: 2 * 1024 * 1024, accept: ".pdf,.doc" });
	assert.deepEqual(form.settings, {
		confirmationMessage: "Thank you, we will be in touch.",
		notifyEmails: ["office@client.example"],
		submitLabel: "Send enquiry",
		spamProtection: "honeypot",
	});
	assert.deepEqual(form.notes, ["dropped [quiz q]: spam is handled by the plugin's honeypot"]);
});

test("WPForms: fields from the JSON definition, with what couldn't be kept noted", () => {
	const form = readForms(xml).forms[1];
	assert.equal(form.source, "wpforms");
	assert.deepEqual(
		form.pages[0].fields.map((f) => [f.name, f.type, f.required, f.options?.length]),
		[
			["name", "text", true, undefined],
			["email", "email", true, undefined],
			["contact_me_by", "radio", false, 2],
		],
	);
	assert.equal(form.settings.submitLabel, "Go");
	assert.equal(form.settings.confirmationMessage, "Thanks!");
	assert.deepEqual(form.settings.notifyEmails, []);
	assert.equal(form.notes.length, 4, form.notes.join("\n"));
	assert.ok(form.notes.some((n) => n.includes("{admin_email}")));
	assert.ok(form.notes.some((n) => n.includes("payment-single")));
});

test("shortcodes become form blocks: by ID, by CF7 hash, Jetpack inline, and one stand-in per missing form", () => {
	const prepared = prepareExport(xml, "client.xml");
	assert.ok(!prepared.xml.includes("wpcf7_contact_form") && !prepared.xml.includes("<wp:post_type>wpforms"), "form posts removed");
	const bySlug = Object.fromEntries(prepared.shortcodes.map((e) => [`${e.slug}:${e.marker.split(":")[2]}`, e.data]));
	assert.deepEqual(bySlug["contact:0}}"], { kind: "form", slug: "contact-form-1" });
	assert.deepEqual(bySlug["home:0}}"], { kind: "form", slug: "contact-form-1" });
	assert.deepEqual(bySlug["home:1}}"], { kind: "form", slug: "quick-enquiry" });
	assert.deepEqual(bySlug["quote:0}}"], { kind: "form", slug: "quote-request" });
	assert.deepEqual(bySlug["quote:1}}"], { kind: "form", slug: "quote-request" });
	assert.deepEqual(bySlug["jetpack:0}}"], { kind: "form", slug: "say-hello" });

	assert.deepEqual(prepared.forms.map((f) => [f.slug, f.source]), [
		["contact-form-1", "contact-form-7"],
		["quick-enquiry", "wpforms"],
		["quote-request", "standard"],
		["say-hello", "jetpack"],
	]);
	const jetpack = prepared.forms[3];
	assert.deepEqual(jetpack.settings.notifyEmails, ["team@client.example"]);
	assert.deepEqual(jetpack.pages[0].fields.map((f) => [f.name, f.type]), [["name", "text"], ["topic", "select"]]);

	const report = describePrepared(prepared).join("\n");
	assert.match(report, /4 form\(s\) will be created/);
	assert.match(report, /quote-request: the export doesn't include this form/);
});

test("form blocks point at the plugin's form ID once it exists", () => {
	const block = (ids?: Record<string, string>) => buildBlocks({ kind: "form", slug: "contact-form-1" }, () => ({ local: true, url: "" }) as any, () => "k", () => {}, ids)[0];
	assert.deepEqual(block(), { _type: "emdash-form", _key: "k", formId: "contact-form-1" });
	assert.equal(block({ "contact-form-1": "01ABC" }).formId, "01ABC");
});

test("toFormSlug follows the plugin's slug rule", () => {
	assert.deepEqual(["Contact Form 7", "Café booking", "2024 survey", "!!!"].map(toFormSlug), ["contact-form-7", "cafe-booking", "form-2024-survey", "form-untitled"]);
});

test("fixForms creates new forms, leaves existing ones alone, and returns their IDs", async () => {
	const calls: [string, any][] = [];
	const rest: RestClient = {
		get: async () => ({}),
		post: async (path: string, body: any) => {
			calls.push([path, body]);
			if (path.endsWith("/forms/list")) return { items: [{ id: "01OLD", slug: "contact-form-1" }] } as any;
			if (body.slug === "broken") throw new Error("400");
			return { id: `01${body.slug.toUpperCase()}` } as any;
		},
	};
	const forms = readForms(xml).forms.slice(0, 2);
	const broken: FormSpec = { ...forms[1], slug: "broken", notes: [] };
	const report = await fixForms({ forms: [...forms, broken], rest });
	assert.deepEqual(report.ids, { "contact-form-1": "01OLD", "quick-enquiry": "01QUICK-ENQUIRY" });
	assert.deepEqual(report.existing, [{ slug: "contact-form-1", id: "01OLD" }]);
	assert.equal(report.failed[0].slug, "broken");
	assert.equal(calls.filter(([p]) => p.endsWith("/forms/create")).length, 2);
	const created = calls.find(([, b]) => b.slug === "quick-enquiry")![1];
	assert.deepEqual(Object.keys(created), ["name", "slug", "pages", "settings"]);
	assert.deepEqual(report.toReview.map((r) => r.slug), ["contact-form-1", "quick-enquiry"]);
});
