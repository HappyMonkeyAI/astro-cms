// Claim HappyMonkey staging with setup-guard cookie, then mint admin token.
// usage: node remote-claim.mjs
import fs from "node:fs";

const base = "http://127.0.0.1:4510";
const envPath = "/home/stephen/sites/happymonkey/.env";
const env = Object.fromEntries(
	fs
		.readFileSync(envPath, "utf8")
		.split("\n")
		.filter((l) => l.includes("="))
		.map((l) => {
			const i = l.indexOf("=");
			return [l.slice(0, i), l.slice(i + 1)];
		}),
);
const setupToken = env.ASTRO_CMS_SETUP_TOKEN?.trim();
if (!setupToken) {
	console.error("missing ASTRO_CMS_SETUP_TOKEN");
	process.exit(1);
}

const email = "admin@happymonkey.local";
const password = `HmDogfood-${setupToken.slice(0, 12)}!a1`;
const setupLink = `${base}/_emdash/admin?setup_token=${setupToken}`;

const unlock = await fetch(setupLink, { redirect: "manual" });
const unlockCookie = (unlock.headers.getSetCookie?.() ?? [])
	.map((c) => c.split(";")[0])
	.join("; ");
console.log("unlock", unlock.status, unlockCookie ? "cookie-ok" : "no-cookie");

const h = {
	"Content-Type": "application/json",
	"X-EmDash-Request": "1",
	Origin: base,
	Cookie: unlockCookie,
};
const claim = await fetch(`${base}/_emdash/api/setup/password-admin`, {
	method: "POST",
	headers: h,
	body: JSON.stringify({ email, name: "HappyMonkey Admin", password }),
});
console.log("claim", claim.status, (await claim.text()).slice(0, 200));

const login = await fetch(`${base}/_emdash/api/auth/password/login`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"X-EmDash-Request": "1",
		Origin: base,
	},
	body: JSON.stringify({ email, password }),
});
if (!login.ok) {
	console.error("login failed", login.status, await login.text());
	process.exit(1);
}
const Cookie = login.headers
	.getSetCookie()
	.map((c) => c.split(";")[0])
	.join("; ");
const tokenRes = await fetch(`${base}/_emdash/api/admin/api-tokens`, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"X-EmDash-Request": "1",
		Origin: base,
		Cookie,
	},
	body: JSON.stringify({
		name: "hm-dogfood",
		scopes: ["admin"],
		expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
	}),
});
const tokenJson = await tokenRes.json().catch(() => ({}));
const token = tokenJson.data?.token;
if (!token) {
	console.error("token failed", tokenRes.status, JSON.stringify(tokenJson).slice(0, 300));
	process.exit(1);
}

const out = "/home/stephen/sites/happymonkey/credentials.txt";
fs.writeFileSync(
	out,
	[
		`BASE=${base}`,
		`PUBLIC=http://192.168.5.215:4510`,
		`EMAIL=${email}`,
		`PASSWORD=${password}`,
		`ADMIN_TOKEN=${token}`,
		"",
	].join("\n"),
	{ mode: 0o600 },
);
console.log("wrote", out);
console.log("TOKEN_OK");
