import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeSnippet, searchConfig, START_SEL, STOP_SEL, toTsQuery, weightClass } from "../src/text.ts";

test("toTsQuery: prefix terms joined with AND", () => {
	assert.equal(toTsQuery("hel wor"), "hel:* & wor:*");
	assert.equal(toTsQuery("  Café   déjà-vu "), "Café:* & déjà:* & vu:*");
	assert.equal(toTsQuery("don't"), "dont:*");
	assert.equal(toTsQuery(""), "");
	assert.equal(toTsQuery(undefined), "");
	assert.equal(toTsQuery("!!! ---"), "");
});

test("toTsQuery: quoted phrases become followed-by", () => {
	assert.equal(toTsQuery('"exact phrase" more'), "(exact <-> phrase) & more:*");
	assert.equal(toTsQuery('"single"'), "single:*");
	assert.equal(toTsQuery('unbalanced "quote'), "unbalanced:* & quote:*");
});

test("toTsQuery never passes tsquery syntax through", () => {
	for (const hostile of ["a & b", "a | b", "!a", "a:*B", "a <-> b", "(a)", "a' | 'b", "a:A", "'); DROP TABLE x; --"]) {
		const out = toTsQuery(hostile);
		assert.doesNotMatch(out.replace(/:\*|<->| & |\(|\)/g, ""), /[&|!:<>()';-]/, `${hostile} -> ${out}`);
	}
	assert.equal(toTsQuery(Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")).split(" & ").length, 12);
});

test("weightClass maps EmDash weights to A-D", () => {
	assert.equal(weightClass(undefined, true), "A");
	assert.equal(weightClass(undefined, false), "C");
	assert.equal(weightClass(5, false), "A");
	assert.equal(weightClass(2, true), "B");
	assert.equal(weightClass(1, true), "C");
	assert.equal(weightClass(0, false), "D");
});

test("sanitizeSnippet escapes everything except our <mark> markers", () => {
	assert.equal(sanitizeSnippet(`a <script>x</script> & ${START_SEL}hit${STOP_SEL} "q"`), "a &lt;script&gt;x&lt;/script&gt; &amp; <mark>hit</mark> &quot;q&quot;");
	assert.equal(sanitizeSnippet("<mark>fake</mark>"), "&lt;mark&gt;fake&lt;/mark&gt;");
	assert.equal(sanitizeSnippet(null), undefined);
	assert.equal(sanitizeSnippet("   "), undefined);
});

test("searchConfig accepts only identifier-like names", () => {
	assert.equal(searchConfig({}), "english");
	assert.equal(searchConfig({ PG_SEARCH_CONFIG: "Simple" }), "simple");
	assert.equal(searchConfig({ PG_SEARCH_CONFIG: "english'; drop" }), "english");
});
