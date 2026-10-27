# @astro-cms/cli

Agency CLI for astro-cms sites. Authenticates with an admin-scope API token in `ASTRO_CMS_ADMIN_TOKEN`.

## Agents (recommended)

Each AI agent gets its **own non-admin account** that owns its token:

```bash
astro-cms agent create  --base https://client.example --name "Content agent"            # agent-editor, 90 days
astro-cms agent create  --base … --name "Audit bot" --profile agent-readonly --expires 30d
astro-cms agent list    --base …
astro-cms agent disable --base … --id <agent-user-id>                                   # its tokens stop at once
```

Why not a token made by an admin? EmDash checks the **token owner's** role and attributes edits to the owner. An admin-made agent token would therefore act as the admin: `agent-guard` couldn't hold its publishes, and history would name the admin (spike F24).

Requires `@astro-cms/auth-password`, which provides the admin-only `/_emdash/api/agents` route.

## Tokens

```bash
astro-cms token profiles
astro-cms token create --base … --profile migration --name "wp-migrate run"             # admin, 1 day
astro-cms token list   --base …
astro-cms token revoke --base … --id <token-id>
```

| Profile | Scopes | Use |
|---|---|---|
| `agent-editor` | content and media read/write, schema read, read-only plugin MCP tools | Agents that draft and edit. Publishing goes to an editor (`agent-guard`); permanent deletes need admin |
| `agent-readonly` | content, media and schema read | Search, summaries, audits |
| `migration` | `admin` | `wp-migrate` runs. Short-lived; never for agents |

The token is printed once and never stored.

```bash
npm test
```
