# Pilot prompt: migrate a real client site and test the whole deployment

This is a self-contained brief for an AI coding agent (or a developer) on another machine. Give the agent this whole file as its task. It covers milestone 7 of `SPEC.md`: take one real WordPress client site and run every step on a fresh host.

The steps are: build the image, generate a site, claim it, migrate the content, check it, then back up and restore. Report what worked and what didn't.

---

## Your task

You're testing **astro-cms**, an agent-native, self-hosted CMS distribution built on EmDash (Astro, Node, Postgres). It's meant to replace WordPress for an agency's client sites.

You have the repository and a real client's WordPress data. Do this:
1. Deploy a fresh astro-cms site with the project's own tooling.
2. Migrate the client site into it.
3. Verify the result thoroughly.
4. Write a report.

**Don't fix the product while you test**, unless a step is completely blocked. The goal is to find out what a real migration hits. If you do work around something, say exactly what and why in the report.

**Before you start**, read these, in this order:
1. `SPEC.md`: what the distribution is, its decisions, and its milestones.
2. `spike/README.md`: findings F1–F26, the known problems and their fixes. **Check here before reporting a "new" problem.**
3. `spike/emdash-site/packages/wp-migrate/README.md`: the migration tool.
4. `spike/emdash-site/packages/cli/templates/site/README.md.tmpl`: the deployment recipe you'll generate.

## Ground rules

**The client data is confidential.**
- Never commit anything from `client-data/` (it's gitignored; keep it that way).
- Never paste client content into issues, commits, pull requests, chat or any external service.
- Never upload it anywhere.

**The report contains client details,** so it goes in `client-data/pilot-report.md`. The only text that may leave `client-data/` is a findings summary for `spike/README.md`, and only when the user approves it. It must use generic wording: no client name, domain, text, image or URL.

**Secrets:**
- The generated `.env`, admin passwords and API tokens stay out of the repository and out of the report.
- Record credentials only in `client-data/pilot-credentials.txt`.

**Version control:**
- Don't push to `main` or any other remote branch without asking the user.
- Work on a local branch (`pilot/<date>`) if you change anything.

**Running things:**
- Only run commands this file or the repo's own docs describe.
- Before running anything else, read what it does.

## What you need

- **Docker** with Compose v2 (`docker compose version`).
- **Node.js 24 or newer** (`node --version`). The tools run TypeScript directly; there's no build step and no `npm install` for `wp-migrate` or the CLI.
- **git.**
- **About 4 GB of free RAM and 10 GB of disk.** The site image takes 10–20 minutes to build.
- **On Windows:** Git for Windows (for `sh`), and keep paths short.

**The client data, put in place by the user:**

```
client-data/
  <export>.xml          WordPress export: Tools → Export → All content
  <uploads>/            a copy of the site's wp-content/uploads folder
```

If either is missing, stop and ask the user.

---

## Steps

Record the time each step takes, and keep its output: you need both for the report.

**Where commands run.** Commands run from the repository root unless stated. The generated site lives **outside** the repo, in a short path such as `~/sites` (`C:\sites` on Windows).

**Variables used below:**
- `REPO`: the repository root.
- `SITE`: the generated site folder.
- `BASE`: `http://localhost:4500`.
- `ADMIN_TOKEN`: the token from step 6.

### 1. Check the repo

```sh
git status                      # clean, on main (or your pilot branch)
git log --oneline -1
for p in wp-migrate cli pg-search setup-guard cookie-consent slider auth-password runtime-config; do
  (cd spike/emdash-site/packages/$p && node --test "test/*.test.ts" 2>&1 | grep -E "^# (pass|fail)|ℹ (pass|fail)")
done
```

Every package should report `fail 0`. If any fails, note it in the report and carry on.

### 2. Build the site image

```sh
docker build -t astro-cms/site:spike spike/emdash-site
```

The build log must include these lines:
- `patched [F11 ssrf system resolver]`
- `patched [F18 oauth runtime env]`
- `patched [SPEC 5.4 destructive MCP tools need the admin scope] … (6 tools)`
- the six `patched [F2 …]` search lines

**A `did not apply` line fails the build.** Report it: it means EmDash's code changed.

### 3. Generate the site

```sh
mkdir -p ~/sites
node spike/emdash-site/packages/cli/src/cli.ts new pilot --port 4500 --dir ~/sites
```

This creates `~/sites/pilot` with:
- `compose.yaml`;
- `.env`, which holds the secrets and the setup token;
- `Caddyfile`;
- `backup.sh` and `restore.sh`;
- a README.

**Copy the printed setup link into `client-data/pilot-credentials.txt`. It's shown only once.** It's also `ASTRO_CMS_SETUP_TOKEN` in `.env`.

Use the default `--port` (loopback only). Don't use `--domain` or Caddy unless the user gives you a real domain and wants HTTPS tested.

### 4. Start it and check it's locked

```sh
cd ~/sites/pilot && docker compose up -d
docker compose ps site             # wait until the site service shows "healthy" (up to about 1 minute); the db is healthy first
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "X-EmDash-Request: 1" -H "Content-Type: application/json" \
  -d '{"email":"x@example.com","password":"long-enough-password-123"}' $BASE/_emdash/api/setup/password-admin
```

The `curl` must print **403** (`SETUP_LOCKED`). Anything else is a security finding: stop and report it.

### 5. Claim the site

Open the setup link in a browser, then create the admin. Use **email and password** for the pilot, and record them in `client-data/pilot-credentials.txt`.

Without a browser:

```js
// claim.mjs (keep it outside the repo): node claim.mjs "<setup link>" <email> <password>
const [link, email, password] = process.argv.slice(2);
const base = new URL(link).origin;
const r = await fetch(link, { redirect: "manual" });
const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const res = await fetch(`${base}/_emdash/api/setup/password-admin`, {
	method: "POST",
	headers: { "Content-Type": "application/json", "X-EmDash-Request": "1", Origin: base, Cookie: cookie },
	body: JSON.stringify({ email, name: "Agency admin", password }),
});
console.log(res.status, await res.text());
```

**Then check both of these:**
- Signing in works: `POST $BASE/_emdash/api/auth/password/login` with `{email, password}` → 200.
- Running the claim again returns 400.

### 6. Get an admin API token for the migration

The `astro-cms token` CLI itself needs an admin token, so create the first token through the API with your session:

```js
// token.mjs: node token.mjs <base> <email> <password>
const [base, email, password] = process.argv.slice(2);
const h = { "Content-Type": "application/json", "X-EmDash-Request": "1", Origin: base };
const login = await fetch(`${base}/_emdash/api/auth/password/login`, { method: "POST", headers: h, body: JSON.stringify({ email, password }) });
const Cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const res = await fetch(`${base}/_emdash/api/admin/api-tokens`, {
	method: "POST",
	headers: { ...h, Cookie },
	body: JSON.stringify({ name: "pilot-migration", scopes: ["admin"], expiresAt: new Date(Date.now() + 86400000).toISOString() }),
});
console.log((await res.json()).data.token);
```

Keep the token in an environment variable (`ADMIN_TOKEN`), not in a file in the repo. It expires after a day.

### 7. Preflight

```sh
node spike/emdash-site/packages/wp-migrate/src/cli.ts preflight client-data/<export>.xml
```

This reports what needs attention: shortcodes, page builders, private and password-protected posts, non-ASCII slugs, menus and media. It changes nothing.

Save the output to `client-data/pilot-out/preflight.txt`.

**Note the site's menu slugs:** you need one for `--assign` in the next step. Preflight suggests one.

**If preflight warns about a local or private legacy host** (for example `localhost`), the export was taken after a search-replace. Ask the user for the live site's URL and add `--production-url https://<live site>` to preflight and migrate. Keep `--uploads` as well.

### 8. Migrate

```sh
EMDASH_TOKEN=$ADMIN_TOKEN node spike/emdash-site/packages/wp-migrate/src/cli.ts migrate client-data/<export>.xml \
  --out client-data/pilot-out --base $BASE \
  --uploads client-data/<uploads> \
  --assign primary=<main-menu-slug>
```

It runs every pass in order:
1. prepare
2. import
3. media
4. local uploads
5. shortcodes
6. media URLs
7. alt text and captions
8. redirects
9. menus
10. baseline revisions
11. the go-live check

**Exit 0 means READY.** A non-zero exit with **NOT READY** lists what's left; that's a result, not a crash.

**If the old site is still online** and some media isn't in the uploads copy, add `--fetch-missing`.

**On Windows (PowerShell),** set the variable first: `$env:EMDASH_TOKEN = "<token>"`.

### 9. Check it

Record each item below as **pass**, **fail** or **n/a**, with numbers.

**Content**
- Published, draft and private counts for posts and pages match the export.
  - Private and password-protected posts should be **drafts**.
  - Use preflight's counts, and the admin or `GET $BASE/_emdash/api/content/<collection>?limit=100`.
- **Spot-check 10 pages**, including the home page, a page-builder page if there is one, the longest post, and one with a gallery or embeds. Compare each against the live WordPress site, if it's reachable:
  - text completeness;
  - headings;
  - images in place;
  - reading order.
  - Expect design loss on page-builder pages (Elementor, Divi and so on). That's documented as F23, and the theme is rebuilt in Astro.
- **Non-ASCII slugs** (accents and so on) open; that's F21.

**Media**
- No broken images on the pages you spot-checked (browser devtools, or `curl` each `<img src>`).
- `wp-migrate check` (step 10) reports **no legacy host URLs** left.
- Alt text came through where WordPress had it.

**Links and navigation**
- **Redirects:** sample 10 old permalinks. Each should give `301` to the new URL, then `200`:

  ```sh
  curl -sI $BASE/<old-path>
  ```

- **Menus:** the primary menu renders, its links work, and nested items keep their order.
- Internal links inside content point at the new URLs.

**Site features**
- **Search:** `$BASE/search?q=<a word from a page title>` returns that page. Search is Postgres full-text (F2). New sites and EmDash's importer enable it automatically.
  - If it returns nothing, enable it with `POST $BASE/_emdash/api/search/enable {"collection":"posts","enabled":true}` (and the same for `pages`), using your session or token, and note this in the report.
- **Cookie banner:**
  - It shows on a first visit, and "Reject non-essential" hides it.
  - Its preferences are collapsed until "Manage preferences" is clicked.
  - It never appears in the admin.

**Admin and safety**
- **Admin:** sign in, edit a page, save, then publish. The revision history shows the edit, and the migrated state is a revision you can go back to (baseline).
- **migration-guard:** the **Migration issues** admin page lists any leftovers. A page with a leftover (e.g. an unconverted contact-form shortcode) **can't be published** until fixed. That's intended (F16 and F23); record which shortcodes or plugins were involved.
- **Agent safety (optional, if time allows):**
  1. Create an agent with `ASTRO_CMS_ADMIN_TOKEN=$ADMIN_TOKEN node spike/emdash-site/packages/cli/src/cli.ts agent create --base $BASE --name "Pilot agent"`.
  2. Have an MCP client using that token publish an edit; it must appear under **Agent approvals** rather than going live.

### 10. Go-live check (on its own)

```sh
EMDASH_TOKEN=$ADMIN_TOKEN node spike/emdash-site/packages/wp-migrate/src/cli.ts check --prepared client-data/pilot-out --base $BASE
```

Record the verdict and every remaining item.

**Don't clear the list by deleting content.** Classify each item:
- **needs a plugin we don't have:** forms, sliders, galleries and so on;
- **needs a human decision;**
- **a wp-migrate bug.**

### 11. Backup and restore

```sh
cd ~/sites/pilot
sh backup.sh                                  # note the stamp it prints, and both file sizes
# change something visible: e.g. retitle a page and publish it
sh restore.sh <stamp>
```

After the restore:
- The change is gone.
- The admin still signs in.
- Images still load.

Time both scripts.

### 12. Clean up (only when the user says so)

```sh
cd ~/sites/pilot && docker compose down        # keeps the data volumes
# docker compose down -v                       # also deletes the database and uploads: only when told to
```

---

## Known gotchas

Most of these are already in `spike/README.md`:

- **Build time:** image builds take 10–20 minutes. Don't rebuild unless you changed code.
- **Windows paths:** keep the site folder and any generated plugin in **short paths** on Windows. A deep temp path made vitest's workerd pool time out.
- **Blocked DNS-over-HTTPS:** on networks that block it, media fetches only work because of the F11 patch. If the build log lacks `patched [F11 …]`, media import will fail with `SSRF_BLOCKED`.
- **`setupGuard()` comes first:** it must stay **before** `emdash()` in `astro.config.mjs`, or the setup link stops working.
- **Uploads volume:** the site must keep `UPLOADS_DIR` on a volume. The generated `compose.yaml` does. A container without one loses its media on recreation.
- **Search speed:** about 0.5 ms per published entry. Note it if the client site is large (over 1,000 entries).
- **Plugin routes:** these are at `/_emdash/api/plugins/<slug>/<route>` and need the `X-EmDash-Request: 1` header.
- **Server-side media fetches:** these refuse private and LAN addresses (the SSRF guard). Use `--uploads` for a site that isn't publicly reachable.
- **Setup link:** it's `$BASE/_emdash/admin?setup_token=<token>`, as `astro-cms new` prints it. There is no `/_emdash/setup/<token>` route (404).
- **Waiting for health:** wait for the **site** service (`docker compose ps site`). Postgres becomes healthy first, so any "(healthy)" line isn't enough.
- **Staging exports:** an export taken after a search-replace to `localhost` names a host EmDash can't fetch from. Use `--production-url` and `--uploads` (spike F27).

---

## Report

Write `client-data/pilot-report.md` with these sections:

1. **Summary:** READY or NOT READY, the total time, and the three most important findings.
2. **Environment:**
   - the OS, Docker, Node and RAM;
   - the repo commit;
   - the size of the export (posts, pages, attachments, menus) and of the uploads.
3. **Timings:** each step.
4. **Checklist:** every item from step 9, with pass, fail or n/a and the numbers.
5. **Go-live leftovers:** each remaining item with its classification.
6. **Findings:** each new problem, written as in `spike/README.md`:
   - a severity (🔴 blocks the pilot, 🟠 needs work before v0.1, 🟢 minor or doc);
   - what happened;
   - steps to reproduce;
   - the suspected cause;
   - a suggested fix.
   - Mark any that are already a known F-number.
7. **Workarounds:** anything you changed or did by hand to get through.
8. **Proposed `spike/README.md` text:** generic findings with no client details, for the user to approve before anything is committed.

Then tell the user the report is ready, give the summary in a few lines, and ask before committing anything.
