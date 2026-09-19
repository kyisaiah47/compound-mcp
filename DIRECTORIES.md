# Where compound-mcp and the ParseRail plugin are listed

Re-read live 2026-09-19. Most of this surface is armed and watched by
`compound.shared.mcpdir.tick` (`compound-ops/portals/mcpdir/tick.mjs`, every 6 hours), this file
records state, it does not replace that job. Its own `state.json` is the live source; this is
a snapshot plus the items that job does not cover.

⛔ **THE PACKAGE IS CALLED `compound-mcp` AND IT KEEPS THAT NAME.** This repo was renamed to
compound-mcp on 2026-09-12 and npm never was, so for a week every install line in the repo, in
`smithery.yaml` and in the mcpservers.org lane named a package that returned 404 while the one
doing 427 downloads a month kept its old name. Isaiah settled it on 2026-09-19: the package
name stays, the BRANDING is what moves to Compound Labs. `package.json` still carries
`"name": "compound-mcp"` and a `compound-mcp` bin, which is the one thing left disagreeing with
npm and is his call to make.

⛔ **THE `studio.compound` NAMESPACE WAS NEVER OURS TO PUBLISH UNDER, and that is why the
registry row sat stale for a month.** MCP registry DNS auth verifies the reverse-DNS domain, so
`studio.compound` means `compound.studio`, which is on Google Domains nameservers and is not in
our Cloudflare account. The domains we hold are civicbinder.org, kynth.studio, outrip.lol,
thecompound.tech and unemploy.co. The registry entry is `tech.thecompound/compound-mcp`, and the
private key for that namespace is now in Bitwarden under "MCP Registry DNS auth (kynth.studio)".

## compound-mcp (eleven free, keyless, read-only tools)

| Directory | State | URL |
| --- | --- | --- |
| npm | live as `compound-mcp` `0.4.2`. `kynth-mcp` is deprecated on all 7 versions and points here; it carried 427 downloads in the 30 days to 2026-09-16 | https://www.npmjs.com/package/compound-mcp |
| Official MCP registry | live and current, `tech.thecompound/compound-mcp` 0.4.0, `isLatest` true, published 2026-09-19 | https://registry.modelcontextprotocol.io/v0/servers?search=tech.thecompound/compound-mcp |
| Glama | live. Listing name `compound-mcp`, hand entered description rewritten to Compound Labs 2026-09-19, repository re-synced | https://glama.ai/mcp/servers/fhf0eohm9v |
| LobeHub | PASS | https://lobehub.com/mcp/kyisaiah47-compound-mcp |
| mcpservers.org | listed, blurb STALE ("Ten keyless lookups"). A corrected free submission naming Compound Labs went in 2026-09-19, review within 2 weeks | https://mcpservers.org/search?query=compound-mcp |
| Smithery | NOT LISTED and not listable as it stands. `smithery.ai/servers/new` now asks for a namespace, a server id and an **MCP Server URL**, "the HTTP URL where your MCP server is accessible". There is no stdio or npx route on that form any more. compound-mcp runs over stdio through npx and has no deployed public endpoint, so listing it needs a hosted Streamable HTTP instance first, which is the same prerequisite the Claude connectors directory wants below | https://smithery.ai/servers/new |
| PulseMCP | NOT LISTED, and CLOSED. Searching `compound-mcp` returns 0 of 0; searching `kynth` returns only Kynth Core, bylined "Kynth Studios". The site banner read live 2026-09-19: "New server submissions and listing changes are still paused while we rework how we ingest and manage listings." There is no submit or edit route to take until they reopen | https://www.pulsemcp.com/servers?q=compound-mcp |
| mcp.so | UNRESOLVED, free route is a support ticket with no status surface, mcpdir job is chasing it | https://mcp.so/server/compound-mcp/kyisaiah47 |
| Cursor Directory (cursor.directory) | NOT SUBMITTED, see below | https://cursor.directory/mcp |
| Claude connectors directory | NOT PURSUED, see below | n/a |

⛔ **A SEARCH-PAGE MATCH ON "compound" IS A FALSE PASS AND IT HID ALL OF THIS.** `verify.mjs`
reported PASS for both mcpservers.org and PulseMCP off `/compound/i` against a results page.
Read live 2026-09-19, mcpservers.org's `?query=compound` returns 13 servers and not one of them
is ours (junct-bot's Compound Finance server, PubChem, DeFi Rates and so on), and PulseMCP's
`?q=compound` returns 14 in the same shape. Both rows now search `kynth`, which is the word only
our listings carry.

## ParseRail plugin / @compound/api-mcp (compound-claude-plugin repo)

| Directory | State | URL |
| --- | --- | --- |
| Self-hosted marketplace (GitHub) | live | https://github.com/kyisaiah47/compound-claude-plugin |
| npm (`@compound/api-mcp`) | live, `0.5.2`, published from the parserail repo, out of this repo's scope | https://www.npmjs.com/package/@compound/api-mcp |
| Official MCP registry (`studio.compound/core`) | live, `0.5.2`, current | https://registry.modelcontextprotocol.io/v0/servers?search=studio.compound/core |
| Anthropic's official Claude Code plugin directory (github.com/anthropics/claude-plugins-official) | **submitted 2026-08-14, under review.** Tracked in `compound-ops/portals/mcpdir/tick.mjs`, the `HOLDS` list, under the pre-rename name "Compound Core" and slug `compound-core`. The plugin itself renamed to ParseRail 2026-09-04 (`marketplace.json` carries a `renames` migration); the submission's own answers were deliberately left on the old name per that file's own rule (renaming mid-review is worse than the inconsistency). The due date on that hold is 2026-09-04, today, worth a status check on the next mcpdir tick. | n/a, Console wizard, no public listing URL until approved |
| Claude connectors directory | NOT PURSUED, see below | n/a |
| Smithery, mcpmarket.com, n8n Creator Portal, Zapier, Gemini CLI gallery | covered by the mcpdir job for `studio.compound/core`, not duplicated here | see `compound-ops/portals/mcpdir/state.json` |

## Claude connectors directory: not pursued, for both

Read live 2026-09-04 (`platform.claude.com/docs/en/build-with-claude/mcp-connectors` and the
Anthropic Connectors Directory FAQ): submission needs a **Streamable HTTP** remote endpoint, a
public privacy policy URL, test credentials, and, per the standing memory
`claude-connectors-directory-requirements.md` (verified 2026-07-09, still current), an
**org account on Claude.ai Team/Enterprise**, since the submission/management dashboard lives
under `claude.ai/admin-settings/directory` and does not exist on an individual plan.

- **compound-claude-plugin / ParseRail** is a local Claude Code plugin (stdio, `npx` at install
  time). It is not a remote connector at all: Claude Code plugins have no Anthropic-run
  submission registry (confirmed live from `code.claude.com/docs/en/plugin-marketplaces`:
  "Anthropic does not maintain a central submission registry"; distribution is
  self-hosted marketplaces, which this repo already is). The one Anthropic-run listing that
  does exist for plugins is the official plugin directory above, already submitted.
- **compound-mcp** is keyless, so it does not carry the OAuth/billing conflict the memory
  documents for the paid ParseRail API (a shared bearer token would pool every connector
  user's calls onto one account's wallet, moot here, there is no wallet). It could
  technically qualify, but two things are missing that no code in this session can supply:
  (1) a public **Streamable HTTP** hosted instance, today `compound-mcp --http` only runs
  locally, there is no deployed public URL; (2) a Claude.ai **Team/Enterprise** org account
  under Isaiah's login, which this session cannot check or create.
- Call: leave both alone. If Isaiah wants compound-mcp in the connectors directory, the two
  prerequisites above are his to supply (a hosting decision, and his own account tier); once
  both exist this becomes a normal submission.

## Cursor Directory (cursor.directory): queued, not submitted

Free, third-party (not Anthropic- or Cursor-run), submission form at
`cursor.directory/mcp/submit` (rate-limited on the one live check this session made). Genuinely
uncovered by the mcpdir job. Its form is a plain web submission, the same shape as mcp.so and
mcpmarket.com, which the mcpdir job already drives through the shared `chromed` daemon and
session-login library (`compound-ops/portals/mcpdir/lib`, `emailsignin.mjs`). That plumbing lives
outside this repo's scope and this session had no daemon session to reuse it with, so rather
than hand-roll a second one-off browser script, this is left as a queued target for that job:
add a `run-cursor-directory.mjs` following the `run-mcpmarket.mjs` pattern (repo URL,
description, npm package `compound-mcp`, no login required per the guide read live). Noted here so
nobody re-derives this research.
