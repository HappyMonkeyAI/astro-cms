# Agent instructions

Before editing this plugin, read both files in `skills/creating-plugins/` completely:
- `SKILL.md`: EmDash's rules for sandboxed plugins (capabilities, hooks, routes, Block Kit, testing).
- `ASTRO-CMS.md`: lessons from building astro-cms plugins (runtime gotchas that the docs get wrong).

Keep `emdash-plugin.jsonc` aligned with the runtime implementation, and declare every capability and host the plugin uses. After every change run `npm run check` (typecheck, manifest validation, tests and build). Bump the version in `package.json` when runtime behaviour or the trust contract changes.
