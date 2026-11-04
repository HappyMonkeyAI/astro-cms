// Seed content into a claimed site via admin API.
import fs from "node:fs";

const siteDir = "/home/stephen/sites/happymonkey";
const base = "http://127.0.0.1:4510";
const creds = Object.fromEntries(
	fs
		.readFileSync(`${siteDir}/credentials.txt`, "utf8")
		.trim()
		.split("\n")
		.map((l) => {
			const i = l.indexOf("=");
			return [l.slice(0, i), l.slice(i + 1)];
		}),
);
const token = creds.ADMIN_TOKEN;
const seed = JSON.parse(
	fs.readFileSync(
		"/home/stephen/projects/astro-cms/spike/themes/happymonkey/seed/seed.json",
		"utf8",
	),
);

const h = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${token}`,
	"X-EmDash-Request": "1",
	Origin: base,
};

async function api(method, path, body) {
	const res = await fetch(`${base}/_emdash/api${path}`, {
		method,
		headers: h,
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text.slice(0, 400) };
	}
	return { ok: res.ok, status: res.status, json };
}

function stripMedia(data) {
	if (!data || typeof data !== "object") return data;
	const out = { ...data };
	for (const [k, v] of Object.entries(out)) {
		if (v && typeof v === "object" && v.$media) {
			out[k] = { src: v.$media.url, alt: v.$media.alt || "" };
		}
	}
	return out;
}

const results = [];
for (const [collection, entries] of Object.entries(seed.content || {})) {
	for (const entry of entries) {
		const slug = entry.slug || entry.id;
		const payload = {
			slug,
			status: "draft",
			data: stripMedia(entry.data || {}),
		};
		// Skip bylines on create; assign later if needed.
		const created = await api("POST", `/content/${collection}`, payload);
		let published = { ok: true, status: 0 };
		if (created.ok) {
			const id = created.json?.data?.id || created.json?.data?.entry?.id || slug;
			published = await api("POST", `/content/${collection}/${id}/publish`, {});
			if (!published.ok) {
				published = await api("POST", `/content/${collection}/${slug}/publish`, {});
			}
		}
		results.push({
			collection,
			slug,
			create: created.status,
			publish: published.status,
			ok: created.ok && published.ok,
			err: created.ok
				? published.ok
					? undefined
					: published.json
				: created.json,
		});
	}
}

console.log(JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.ok);
console.log(`done ok=${results.length - fails.length} fail=${fails.length}`);
process.exit(fails.length ? 1 : 0);
