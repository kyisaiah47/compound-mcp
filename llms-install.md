# Installing OpenLookup

`openlookup` provides eleven read-only lookup tools over live public data. There is **no API key, no
signup and no account** — configuration is the command and nothing else.

Most of the tools answer questions a model cannot answer correctly from a training cutoff,
because the underlying fact changed after it: what a model costs today, whether a library is
still maintained, what a service's published price is this week.

## Configure the server

```json
{
  "mcpServers": {
    "openlookup": {
      "command": "npx",
      "args": ["-y", "openlookup"]
    }
  }
}
```

- **Cline**: add the block above to `cline_mcp_settings.json` (MCP Servers → Configure).
- **Claude Code**: `claude mcp add openlookup -- npx -y openlookup`
- **Claude Desktop**: same JSON in `claude_desktop_config.json` (Settings → Developer → Edit Config).
- **Cursor / VS Code / Windsurf**: same JSON under their MCP settings.

The server is also published in the official MCP registry as `tech.thecompound/openlookup`.

## Verify the install

Ask for something that must be current — the answer proves the tools resolved rather than the
model answering from memory:

```
> which model should I use for a coding agent on a budget?
> is <some library> still maintained?
> what does Supabase Pro cost right now, and when was that price last checked?
```

`compare_ai_models` returns a `captured_on` date and a per-row `rationale`; `lookup_service_pricing`
returns the date each plan was last verified against the vendor's own page. If you see those
fields, the server is answering.

## Requirements

- Node.js 18+ (the server runs via `npx`)
- Outbound HTTPS. No credentials of any kind.

## Local HTTP mode (optional)

```sh
npx -y openlookup --http 8974   # streamable HTTP on http://127.0.0.1:8974/mcp
```

Loopback only, with DNS-rebinding protection on — it is for a local client, not for exposing
the server to a network.
