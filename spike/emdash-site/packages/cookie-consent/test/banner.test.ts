import assert from "node:assert/strict";
import { test } from "node:test";

import { CLIENT_SCRIPT, DEFAULTS, renderBanner, resolveSettings, safeUrl } from "../src/banner.ts";

test("settings: stored over options over defaults, wrong types and blanks ignored", () => {
	const s = resolveSettings({ title: "From config", revision: 2 }, { title: "From admin", message: "  ", revision: "3", position: "sideways" });
	assert.equal(s.title, "From admin");
	assert.equal(s.message, DEFAULTS.message);
	assert.equal(s.revision, 2);
	assert.equal(s.position, "bottom");
	assert.equal(resolveSettings({ revision: 0 }).revision, 1);
	assert.equal(resolveSettings({ policyUrl: "/x" }, { policyUrl: "" }).policyUrl, "", "an editor can clear the policy link");
});

test("safeUrl allows site paths and http(s) only", () => {
	assert.equal(safeUrl("/pages/cookies"), "/pages/cookies");
	assert.equal(safeUrl("https://example.com/c"), "https://example.com/c");
	for (const bad of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "pages/cookies"]) assert.equal(safeUrl(bad), undefined, bad);
});

test("banner escapes editor text and drops unsafe links", () => {
	const html = renderBanner(resolveSettings({ title: '<img src=x onerror="alert(1)">', policyUrl: "javascript:alert(1)", acceptLabel: "Yes & go" }));
	assert.doesNotMatch(html, /<img/);
	assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
	assert.doesNotMatch(html, /javascript:/);
	assert.match(html, /Yes &amp; go/);
	assert.match(html, / hidden>/, "hidden until the script decides, so no flash for returning visitors");
});

test("banner carries revision and consent-mode flag for the client script", () => {
	const html = renderBanner(resolveSettings({ revision: 4, googleConsentMode: true, policyUrl: "/cookies" }));
	assert.match(html, /data-revision="4"/);
	assert.match(html, /data-gcm="1"/);
	assert.match(html, /<a href="\/cookies">Cookie policy<\/a>/);
	assert.doesNotMatch(renderBanner(DEFAULTS), /data-gcm|<a /);
});

test("client script parses", () => {
	assert.doesNotThrow(() => new Function(CLIENT_SCRIPT));
});
