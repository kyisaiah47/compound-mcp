# OpenLookup

MCP server from [Compound Labs](https://thecompound.tech). Eleven read-only lookup tools backed by live public data — no API key, no signup, nothing to sign up for.

`mcp-name: tech.thecompound/openlookup`

OpenLookup was published on npm as `compound-mcp` until 2026-10-02. That package is deprecated and points here. Install `openlookup` instead.

Most of these answer questions that a model cannot answer correctly from a training cutoff, because the underlying fact changed after it: what a model costs today, whether a library is still maintained, whether someone has already published the skill you are about to write.

## Tools

### Things that go stale

| Tool | Answers |
| --- | --- |
| `compare_ai_models(board?, limit?)` | Current AI model pricing and which models the major coding tools actually route to, sampled nightly. Boards by budget band (`budget/free` … `budget/premium`) or by tool (`tool/claude-code`, `tool/codex-cli`, `tool/cline`, `tool/aider`, …). Ranked on adoption, not capability — each row carries the rationale that says so. |
| `check_project_maintenance(q?, limit?)` | Whether a developer tool is still shipping: last release, last commit, whether it reads as dead. Run it before recommending a dependency. |
| `lookup_service_pricing(category?, service?)` | Published pricing and free-tier limits for auth, database, payments, email and hosting services — each plan carrying the date its published price was last verified against the vendor's own page. |
| `estimate_stack_cost(stack, users?)` | An itemised monthly bill for a named stack at a chosen user count, showing which lines are included in the base fee and which are metered. |

### Directories

| Tool | Answers |
| --- | --- |
| `search_agent_skills(q, kind?, limit?)` | Published Claude Code skills, plugins and marketplaces, ranked by installs. Returns the install command, so the answer is directly actionable. |
| `search_agent_configs(stack?, format?, tag?, min_quality?, limit?)` | Real `AGENTS.md`, `CLAUDE.md`, Cursor, Copilot, Windsurf, GEMINI.md and Cline files from public repositories, scored for quality — how well-maintained projects on a given stack actually write theirs. |
| `search_component_registries(q, kind?, access?, limit?)` | shadcn-compatible components, blocks and hooks across dozens of public registries, with their dependencies so you can judge the cost of pulling one in. |
| `grade_starter_kit(q?, limit?)` | Starter kits and boilerplates, graded by installing them: what is actually wired up versus what only appears in the README. |
| `compare_app_builders(builder?, verdict?, limit?)` | Whether the app an AI mobile-app builder hands you clears Apple App Store review — what it outputs, whether you can export the source, who submits the binary, and which guidelines are in play. Every verdict carries the source that settles it and the date it was read; an unsettled question comes back `unknown` rather than guessed. |

### Compliance

### `lookup_ada_report(domain)`

Looks up a US local-government domain in the [CivicBinder Municipal Web Accessibility Index](https://civicbinder.org/ada) — axe-core scans of local-government .gov websites, graded A–F against WCAG 2.1 AA ahead of the ADA Title II deadlines (April 26, 2027 for communities of 50,000+; April 26, 2028 for smaller communities and special districts).

Returns the grade, violation counts (total / serious / critical), the top failing rules, the entity's deadline, and the public report page (`https://civicbinder.org/ada/<domain>`). The full index is also published as an open dataset at [civicbinder.org/ada/dataset.json](https://civicbinder.org/ada/dataset.json).

### `lookup_nonprofit_status(ein)`

Checks a nonprofit's EIN against the IRS auto-revocation list and the California Registry of Charities delinquency/suspension lists, via [GoodStanding](https://goodstanding.thecompound.tech). Returns revocation and reinstatement dates, whether the streamlined 15-month reinstatement window is still open, and whether AB 488 requires charitable fundraising platforms to block the organization's donation pages. A `clear: true` result means the EIN is on none of the tracked lists.

## Install

```sh
npm install -g openlookup
```

Or run without installing: `npx -y openlookup`

## Run

```sh
openlookup                # stdio (for MCP clients)
openlookup --http 8974    # streamable HTTP on http://localhost:8974/mcp
```

## Claude Code

```sh
claude mcp add openlookup -- npx -y openlookup
```

## Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

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

## Examples

> Which model should I use for a coding agent on a budget?

`compare_ai_models({ board: "budget/value", limit: 3 })` →

```json
{
  "board": "budget/value",
  "captured_on": "2026-08-05",
  "models": [
    {
      "rank": 1,
      "model": "z-ai/glm-5.2",
      "blended_usd_per_mtok": 1.175,
      "price_band": "$1 to $5 / M",
      "rationale": "3.05T tokens through 6 tracked coding tools · ranked on usage, which measures adoption rather than capability."
    }
  ]
}
```

> Is the city website at 36thdistrictcourtmi.gov ADA compliant?

`lookup_ada_report("36thdistrictcourtmi.gov")` →

```json
{
  "found": true,
  "domain": "36thdistrictcourtmi.gov",
  "entity_name": "36th District Court",
  "grade": "A",
  "violations_total": 0,
  "ada_title_ii_deadline": "2027-04-26",
  "report_url": "https://civicbinder.org/ada/36thdistrictcourtmi.gov"
}
```

## Health

Three facts, recorded separately, because a single health endpoint that ANDs them together
cannot say which one broke.

```sh
npm run health          # the working tree, over stdio
npm run health:public   # npx -y openlookup@latest, resolved fresh from npm
```

| Signal | What it answers |
| --- | --- |
| `initialize` | The process spawns and the MCP handshake completes. |
| `tools_list` | The server enumerates its tools. An error and an empty list are both failures. |
| `reachable` | Each public endpoint the tools read answers, right now. Recorded per host. |
| `tool_outcome` | Calling a tool returns a usable payload. Separate from `tools_list` on purpose: a tool can be advertised and not work. |

`--target public` is the deployment check, and it is deliberately outside CI. openlookup has
no deployed HTTP endpoint, so the public path is npm: it spawns the published tarball through
`npx`, with a throwaway cache and from a neutral directory, so what answers is what a stranger
gets rather than this checkout. Build success and externally reachable protocol state are
different facts, and this repo has already shipped a version where they disagreed.

Every signal starts failed and is only flipped by evidence from that run. A timeout, a dead
socket and a signal that could not be attempted are all failures carrying a reason, never a
pass. A finding exits 0 so a scheduled run cannot disarm itself mid outage; `--strict` exits
non zero and is what `ops/npm/publish.mjs` runs after publishing.

Each run writes a dated receipt to `ops/health/receipts/`, and
`ops/health/probe.test.mjs` breaks each signal on its own to prove the separation is real.

Scheduled every 6 hours as `compound.compound-mcp.health`.

## Receipts on the compliance tools

`lookup_ada_report` and `lookup_nonprofit_status` return the verdict and the lookup as separate
fields. `clear` and `grade` are the outcome. `checked` is the receipt: when the lookup ran,
which lists or index were consulted, and what that coverage does not include, so an agent can
explain what it verified without re-running it.

```json
{
  "ein": "475262842",
  "clear": true,
  "checked": {
    "at": "2026-09-20T14:36:34.257Z",
    "sources": [
      "IRS Automatic Revocation of Exemption List",
      "California Attorney General Registry of Charities and Fundraisers"
    ],
    "via": "https://goodstanding.thecompound.tech/api/lookup",
    "scope": "Covers only the two lists named above, as GoodStanding retains them. A clear result means the EIN is absent from those lists. It is not a statement that the organization was never revoked, and no other state registry is consulted."
  }
}
```

## License

MIT © Compound Labs
