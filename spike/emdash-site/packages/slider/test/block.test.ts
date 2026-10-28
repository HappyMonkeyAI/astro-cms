import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_SLIDES, normalizeSlider, safeUrl, SLIDER_BLOCK } from "../src/block.ts";

test("normalizeSlider keeps usable slides and drops unsafe URLs", () => {
	const data = normalizeSlider({
		slides: [
			{ image: " /_emdash/api/media/file/a.jpg ", alt: "A", heading: "Hello", link: "/contact" },
			{ image: "javascript:alert(1)", alt: "bad" },
			{ image: "https://cdn.example.com/b.jpg", link: "javascript:alert(1)", linkLabel: "Go" },
			"not a slide",
			{ alt: "no image" },
		],
	});
	assert.equal(data.slides.length, 2);
	assert.deepEqual(data.slides[0], { image: "/_emdash/api/media/file/a.jpg", alt: "A", heading: "Hello", text: "", link: "/contact", linkLabel: "Find out more" });
	assert.equal(data.slides[1].link, undefined, "unsafe link dropped");
});

test("normalizeSlider bounds autoplay, interval, height and slide count", () => {
	const one = normalizeSlider({ slides: [{ image: "/a.jpg" }], autoplay: true, interval: 1, height: "huge" });
	assert.equal(one.autoplay, false, "a single slide never autoplays");
	assert.equal(one.interval, 3000);
	assert.equal(one.height, "medium");
	const many = normalizeSlider({ slides: Array.from({ length: 20 }, (_, i) => ({ image: `/${i}.jpg` })), autoplay: true, interval: 99, height: "tall" });
	assert.equal(many.slides.length, MAX_SLIDES);
	assert.equal(many.autoplay, true);
	assert.equal(many.interval, 30000);
	assert.equal(many.height, "tall");
	assert.deepEqual(normalizeSlider(undefined).slides, []);
});

test("safeUrl", () => {
	assert.equal(safeUrl("/x"), "/x");
	assert.equal(safeUrl("//evil.example/x"), undefined);
	assert.equal(safeUrl("data:image/png;base64,AA"), undefined);
});

test("editor form uses only Block Kit field types the admin supports in repeaters", () => {
	const repeater = SLIDER_BLOCK.fields?.find((f) => f.type === "repeater") as { fields: Array<{ type: string }> };
	for (const f of repeater.fields) assert.ok(["text_input", "number_input", "select", "toggle"].includes(f.type), f.type);
});
