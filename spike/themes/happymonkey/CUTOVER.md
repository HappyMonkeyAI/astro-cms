# Cutover gate (deferred)

Do **not** point `https://happymonkey.ai` at EmDash until staging on `192.168.5.215:4510` is signed off.

## Preconditions

- Smoke checklist in [DOGFOOD-PROMPT.md](../../../DOGFOOD-PROMPT.md) passes
- Spine `check_design` against `DESIGN.md` is acceptable (or waivers recorded)
- Form recipients configured if using `@emdash-cms/plugin-forms` (staging currently uses mailto)
- Backup/restore exercised on the staging compose site
- Rollback path confirmed: [happymonkey-site](../../../../happymonkey-site) `deploy:static` / existing nginx root under `/home/stephen/www/site.happymonkey.ai`

## Cutover sketch (when approved)

1. Deploy `astro-cms/site:happymonkey` compose site on `192.168.5.80` (or proxy from `.80` to `.215` temporarily).
2. Set `EMDASH_SITE_URL=https://happymonkey.ai`.
3. Switch nginx `happymonkey.ai` upstream from the Astro static/SSR root to the EmDash container (`127.0.0.1:<SITE_PORT>` or unix socket).
4. Keep the previous document root available for instant rollback for at least one deploy cycle.
5. Re-run smoke against the public URL; monitor mail/forms.

Until then, live traffic stays on the current Astro site.
