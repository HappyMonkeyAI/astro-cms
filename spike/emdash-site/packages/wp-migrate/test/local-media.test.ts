import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { contentTypeFor, localPathFor, uploadLocalMedia, uploadsRelativePath } from "../src/local-media.ts";
import type { McpClient } from "../src/mcp-client.ts";
import { readAttachments } from "../src/prepare.ts";

test("uploadsRelativePath maps media URLs into the uploads folder", () => {
	assert.equal(uploadsRelativePath("https://old.test/wp-content/uploads/2016/11/photo.jpg"), "2016/11/photo.jpg");
	assert.equal(uploadsRelativePath("http://192.168.1.20/wp-content/uploads/sites/2/2020/01/a.png?w=300"), "sites/2/2020/01/a.png");
	assert.equal(uploadsRelativePath("//localhost/client/wp-content/uploads/2021/05/caf%C3%A9%20menu.pdf"), "2021/05/café menu.pdf");
	assert.equal(uploadsRelativePath("https://site.files.wordpress.com/2008/06/canola2.jpg?w=150"), "2008/06/canola2.jpg", "WordPress.com / CDN layout");
	assert.equal(uploadsRelativePath("https://old.test/about/"), undefined);
	assert.equal(uploadsRelativePath("https://old.test/2020/01/hello-world/"), undefined, "a date permalink isn't a file");
	assert.equal(uploadsRelativePath("not a url"), undefined);
});

test("localPathFor never resolves outside the uploads folder", () => {
	const root = join(tmpdir(), "uploads-root");
	assert.equal(localPathFor(root, "https://x/wp-content/uploads/2016/11/a.jpg"), join(root, "2016", "11", "a.jpg"));
	assert.equal(localPathFor(root, "https://x/wp-content/uploads/../../etc/passwd"), undefined, "URL parser drops the dot segments");
	assert.equal(localPathFor(root, "https://x/wp-content/uploads/..%2f..%2fsecret.txt"), undefined, "encoded traversal is refused");
	assert.equal(localPathFor(root, "https://x/wp-content/uploads/2016%2f..%2f..%2f..%2fsecret.txt"), undefined);
});

test("contentTypeFor covers common WordPress media", () => {
	assert.equal(contentTypeFor("a.JPG"), "image/jpeg");
	assert.equal(contentTypeFor("menu.pdf"), "application/pdf");
	assert.equal(contentTypeFor("weird.xyz"), "application/octet-stream");
});

test("uploadLocalMedia uploads only what the importer couldn't fetch, and reports what's missing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "wp-uploads-"));
	mkdirSync(join(dir, "2016", "11"), { recursive: true });
	writeFileSync(join(dir, "2016", "11", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
	const calls: any[] = [];
	const mcp: McpClient = {
		async call(tool: string, args: any) {
			calls.push({ tool, filename: args.filename, contentType: args.contentType, bytes: Buffer.from(args.base64, "base64").length });
			return { item: { id: `M-${args.filename}`, url: `/m/${args.filename}` } };
		},
	};
	const report = await uploadLocalMedia({
		uploadsDir: dir,
		attachments: [
			{ wpId: 1, url: "https://old.test/wp-content/uploads/2016/11/a.jpg" },
			{ wpId: 2, url: "https://old.test/wp-content/uploads/2016/11/gone.jpg" },
			{ wpId: 3, url: "https://old.test/wp-content/uploads/2016/11/already.jpg" },
			{ wpId: 4, url: "https://cdn.test/elsewhere/b.jpg" },
		],
		imported: [{ wpId: 3, originalUrl: "x", newUrl: "/m/already.jpg", mediaId: "M3" }],
		mcp,
	});
	assert.deepEqual(report.uploaded, [{ wpId: 1, originalUrl: "https://old.test/wp-content/uploads/2016/11/a.jpg", newUrl: "/m/a.jpg", mediaId: "M-a.jpg" }]);
	assert.equal(report.alreadyImported, 1);
	assert.deepEqual(
		report.missing.map((m) => [m.wpId, m.reason]),
		[
			[2, "file not in the uploads folder"],
			[4, "not a wp-content/uploads URL"],
		],
	);
	assert.deepEqual(calls, [{ tool: "media_upload", filename: "a.jpg", contentType: "image/jpeg", bytes: 4 }]);
});

test("readAttachments lists every attachment in the theme unit test data", () => {
	const fixture = readFileSync(new URL("../../../../fixtures/themeunittestdata.wordpress.xml", import.meta.url), "utf8");
	const attachments = readAttachments(fixture);
	assert.equal(attachments.length, 37);
	assert.ok(attachments.every((a) => uploadsRelativePath(a.url)), "all are wp-content/uploads URLs");
});
