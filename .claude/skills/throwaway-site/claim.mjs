// Claim a fresh astro-cms site with a password admin, then mint an admin-scope API token.
// usage: node claim.mjs <base-url> <email> <password>   (prints the token on stdout)
const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) {
	console.error("usage: node claim.mjs <base-url> <email> <password>");
	process.exit(2);
}
const h = { "Content-Type": "application/json", "X-EmDash-Request": "1", Origin: base };
const post = (path, body, extra = {}) => fetch(`${base}/_emdash/api${path}`, { method: "POST", headers: { ...h, ...extra }, body: JSON.stringify(body) });

const claim = await post("/setup/password-admin", { email, name: "Admin", password });
// 4xx here usually means the site is already claimed; logging in below still works then
if (!claim.ok) console.error(`claim: ${claim.status} (already claimed, or setup locked by SETUP_TOKEN?)`);

const login = await post("/auth/password/login", { email, password });
if (!login.ok) {
	console.error(`login failed: ${login.status} ${await login.text()}`);
	process.exit(1);
}
const Cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const res = await post("/admin/api-tokens", { name: "throwaway", scopes: ["admin"], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() }, { Cookie });
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.data?.token) {
	console.error(`token failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
	process.exit(1);
}
console.log(json.data.token);
