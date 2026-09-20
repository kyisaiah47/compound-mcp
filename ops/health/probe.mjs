#!/usr/bin/env node
// ops/health/probe.mjs, the compound-mcp health probe.
//
//   node ops/health/probe.mjs                     the working tree, over stdio
//   node ops/health/probe.mjs --target public     npx -y compound-mcp@latest, from npm
//   node ops/health/probe.mjs --target public --strict     non zero exit on any failing signal
//   node ops/health/probe.mjs --json              the receipt on stdout, nothing else
//
// ── WHY THIS IS NOT ONE HEALTH ENDPOINT ──────────────────────────────────────────────────
//
// Asked for by @sasame-mcp.bsky.social on 2026-09-10: "record initialize, tools/list, and
// external reachability independently. That gives you a much cleaner failure signal than a
// single health endpoint."
//
// A single endpoint that ANDs several conditions answers one question, up or down, and that
// is the one question nobody needs answered. The useful question is WHICH part broke, and an
// AND gate throws that away before you read it. Worse, it makes the three failures look like
// one failure, so the repair starts in the wrong place.
//
// They are genuinely different facts here, and each one fails on its own:
//
//   initialize   the process spawns and the MCP handshake completes. This is the only signal
//                that can block the others, because the protocol requires the handshake
//                first. It is still recorded on its own, so "handshake fine, everything else
//                broken" is visible rather than averaged away.
//   tools_list   the server enumerates its tools. A server can initialize perfectly and hand
//                back an error, or an empty array, and to the agent that is indistinguishable
//                from "this server does nothing". FIXTURE_MODE=no-tools rehearses it.
//   reachable    the public endpoints this thing depends on answer, from outside, right now.
//                Independent of the two above by construction: it is plain HTTP and runs even
//                when the server will not start at all.
//
// A fourth signal, tool_outcome, is not part of that request. It answers
// @jithox.bsky.social on 2026-09-18: "keep capability lookup separate from the actual outcome
// and retain a dated receipt". tools/list is the capability lookup, what the server SAYS it
// can do. tool_outcome is what happens when you call one. This repo has already paid for that
// distinction: lookup_nonprofit_status listed correctly and returned a protocol error for
// every input it ever received, because the upstream serves ndjson and the client called
// res.json(). tools/list was green throughout.
//
// ── WHY THE PUBLIC TARGET EXISTS ─────────────────────────────────────────────────────────
//
// Same person, 2026-09-06: "One deployment check worth keeping outside CI is a fresh
// initialize + tools/list from the public path. Build success and externally reachable
// protocol state are surprisingly different facts."
//
// compound-mcp has no deployed HTTP endpoint. Read live 2026-09-20, mcp.thecompound.tech is a
// wildcard 307 to the apex and answers no JSON-RPC at all. The public path is npm: every user
// of this server runs `npx -y compound-mcp`, so the published tarball on registry.npmjs.org
// IS the externally reachable protocol state, and the working tree is the build.
//
// Those two have already disagreed in this repo. ops/npm/publish.mjs was written because on
// 2026-08-13 npm was serving PRE-FIX code while the tree, the tests and the git log all said
// it was fixed: `files` in package.json is a whitelist and a path outside it is dropped
// silently at pack time. --target public spawns the published artifact through npx with a
// throwaway npm cache, so what answers is what a stranger gets and never a warm local copy.
//
// ── FAIL CLOSED ──────────────────────────────────────────────────────────────────────────
//
// Every signal starts at ok:false and is only ever flipped to true by evidence collected in
// this run. There is no third state. A spawn that fails, a socket that dies, a request that
// times out and a signal that could not be attempted are all FAILURES carrying a reason, and
// none of them is a pass with a shrug. Every await has a deadline, because a probe that hangs
// is a probe that reports nothing at all.
//
// ── THE EXIT CODE, AND WHY A FINDING IS NOT NON ZERO ─────────────────────────────────────
//
// tools/job-run.sh boots a job out of launchd after 3 consecutive failures carrying the same
// exit code. A health check that exits non zero while the thing it watches is down would
// disarm itself on day one of the outage, which is the exact shape of the contrast sweep
// failure between 2026-09-08 and 09-10: carrying the gate's own exit code out is what left
// that lane unable to clear itself.
//
// So a FINDING exits 0 and is carried in the receipt and the notice. Only a probe that cannot
// produce a verdict at all, its own crash or a receipt it could not write, exits 1. --strict
// reverses this for the places that want a hard gate and have no breaker behind them: the
// post publish check in ops/npm/publish.mjs, and a run by hand.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { API } from '../../src/directories.js';
import { GS_API, SB_KEY, SB_URL } from '../../src/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RECEIPTS = path.join(ROOT, 'ops/health/receipts');
const NOTICES = path.join(os.homedir(), 'CompoundLabs/compound-ops/tools/notices/notices.py');

const HANDSHAKE_TIMEOUT_MS = Number(process.env.PROBE_HANDSHAKE_TIMEOUT_MS || 90_000);
const CALL_TIMEOUT_MS = Number(process.env.PROBE_CALL_TIMEOUT_MS || 20_000);
const HTTP_TIMEOUT_MS = Number(process.env.PROBE_HTTP_TIMEOUT_MS || 15_000);
const KEEP_RECEIPTS = Number(process.env.PROBE_KEEP_RECEIPTS || 200);

/* The reachability targets are built from the SAME constants src/ calls, imported above, not
 * from a second copy of the hostnames. A probe carrying its own list of endpoints stops
 * watching the product the first time a host moves, and reports green while it does. The
 * route suffixes are still written here because only the tools know their own routes, so each
 * one is a real route with a real answer: /api on its own is 404 on every one of these hosts,
 * measured 2026-09-20, and a probe pointed at a 404 is a probe pointed at nothing. */
const EIN_CLEAR = '475262842';
const ADA_DOMAIN = '36thdistrictcourtmi.gov';

const UPSTREAMS = [
  {
    name: 'civicbinder-ada',
    url: `${SB_URL}/rest/v1/cb_ada_scans?status=eq.scanned&select=domain&limit=1`,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  },
  { name: 'goodstanding', url: `${GS_API}?q=${EIN_CLEAR}`, ndjson: true },
  { name: 'rulestack', url: `${API.rulestack}/configs?limit=1` },
  { name: 'skillworks', url: `${API.skillworks}/list?limit=1` },
  { name: 'blockdex', url: `${API.blockdex}/search?q=button&limit=1` },
  { name: 'tooldrift', url: `${API.tooldrift}/leaderboard` },
  { name: 'stillshipping', url: `${API.stillshipping}/dead?limit=1` },
  { name: 'kitgrade', url: `${API.kitgrade}/kits?limit=1` },
  { name: 'stacktab', url: `${API.stacktab}/catalogue` },
  { name: 'storeready', url: `${API.storeready}/builders` },
];

const NPM_REGISTRY = { name: 'npm-registry', url: 'https://registry.npmjs.org/compound-mcp' };

/* Capability says these tools exist. These calls say whether they answer. Each case names a
 * key its own tool description promises, because a tool returning 200 and a row with every
 * promised field missing is the failure this repo's directories smoke test was written for,
 * and counting rows cannot see it. */
const TOOL_CASES = [
  { tool: 'lookup_nonprofit_status', args: { ein: EIN_CLEAR }, expect: 'ein' },
  { tool: 'lookup_ada_report', args: { domain: ADA_DOMAIN }, expect: 'grade' },
  { tool: 'compare_ai_models', args: { limit: 1 }, expect: 'models' },
];

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

/** A signal is born failed. Nothing but evidence collected in this run flips it. */
const failed = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const passed = (extra = {}) => ({ ok: true, reason: null, ...extra });

/** Resolve what the public path is serving right now, straight from the registry. */
async function resolvePublishedVersion(fetchImpl, spec) {
  if (spec && spec !== 'latest') return { version: spec, resolved_from: 'argument' };
  const res = await fetchImpl('https://registry.npmjs.org/compound-mcp', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`npm registry ${res.status}`);
  const body = await res.json();
  const version = body?.['dist-tags']?.latest;
  if (!version) throw new Error('npm registry returned no latest dist-tag');
  return { version, resolved_from: 'dist-tags.latest' };
}

/** One HTTP reachability probe. Any throw, any non 2xx and any unparseable body is a failure. */
async function probeUpstream(fetchImpl, u) {
  const t0 = nowMs();
  try {
    const res = await fetchImpl(u.url, {
      headers: { accept: 'application/json', ...(u.headers || {}) },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const ms = nowMs() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { name: u.name, url: u.url, http: res.status, ms, ...failed(`http ${res.status}: ${body.slice(0, 120)}`) };
    }
    /* A 200 is not an answer. GoodStanding streams ndjson and finishes with the payload, so
     * res.json() dies on line 2 there and reading only the status would call that reachable. */
    const text = await res.text();
    if (u.ndjson) {
      const frames = text.trim().split('\n').filter(Boolean);
      const terminal = frames.some((l) => {
        try {
          return Object.prototype.hasOwnProperty.call(JSON.parse(l), 'result');
        } catch {
          return false;
        }
      });
      if (!terminal) {
        return { name: u.name, url: u.url, http: res.status, ms, ...failed('ndjson stream carried no result frame') };
      }
    } else {
      try {
        JSON.parse(text);
      } catch (e) {
        return { name: u.name, url: u.url, http: res.status, ms, ...failed(`body is not JSON: ${String(e.message).slice(0, 100)}`) };
      }
    }
    return { name: u.name, url: u.url, http: res.status, bytes: text.length, ms, ...passed() };
  } catch (e) {
    return { name: u.name, url: u.url, http: null, ms: nowMs() - t0, ...failed(String(e?.message || e)) };
  }
}

/**
 * Run the probe.
 *
 * Every collaborator the tests need to break is an argument with a real default. The seams are
 * deliberate: proving the three signals fail independently means being able to fail exactly
 * one of them, and a probe that reaches straight for the network and process.argv cannot be
 * asked to do that.
 */
export async function probe(opts = {}) {
  const {
    target = 'local',
    versionSpec = 'latest',
    fetchImpl = fetch,
    command: cmdOverride,
    args: argsOverride,
    env: envOverride,
    upstreams = UPSTREAMS,
    toolCases = TOOL_CASES,
    checkedAt = new Date(),
    handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
    callTimeoutMs = CALL_TIMEOUT_MS,
  } = opts;

  const started = nowMs();
  const receipt = {
    receipt_version: 1,
    /* The dated half of request 2. An agent that called this can say WHAT was checked and
     * WHEN, without re running anything. */
    checked_at: checkedAt.toISOString(),
    target,
    target_command: null,
    repo_version: null,
    published_version: null,
    signals: {
      initialize: failed('not run'),
      tools_list: failed('not run'),
      reachable: failed('not run'),
      tool_outcome: failed('not run'),
    },
    /* Deliberately a LIST of names and not a boolean. The whole point of recording the signals
     * apart is that the summary says WHICH one broke. Empty means every signal passed. */
    failing: [],
    duration_ms: null,
  };

  try {
    receipt.repo_version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    /* the repo version is context on the receipt, never a signal */
  }

  // ── resolve the target ─────────────────────────────────────────────────────────────────
  let command;
  let args;
  let spawnEnv = { ...process.env, ...(envOverride || {}) };
  let cacheDir = null;
  let cwd;

  if (cmdOverride) {
    command = cmdOverride;
    args = argsOverride || [];
    receipt.target_command = [command, ...args].join(' ');
  } else if (target === 'public') {
    try {
      const { version, resolved_from } = await resolvePublishedVersion(fetchImpl, versionSpec);
      receipt.published_version = version;
      receipt.published_version_from = resolved_from;
    } catch (e) {
      /* The registry not answering is a reachability failure AND it means there is no public
       * path to spawn. Both are recorded. Nothing here is allowed to read as a pass. */
      receipt.signals.reachable = failed(`could not resolve the published version: ${String(e?.message || e)}`, {
        checked: 0,
        failed_count: 0,
        probes: [],
      });
      receipt.signals.initialize = failed('not attempted, the public path could not be resolved');
      receipt.signals.tools_list = failed('not attempted, initialize did not run', { blocked_by: 'initialize' });
      receipt.signals.tool_outcome = failed('not attempted, initialize did not run', { blocked_by: 'initialize' });
      receipt.failing = ['initialize', 'tools_list', 'reachable', 'tool_outcome'];
      receipt.duration_ms = nowMs() - started;
      return receipt;
    }
    /* A throwaway cache, so the artifact under test is fetched from registry.npmjs.org on this
     * run. A warm ~/.npm would let a local copy answer and the probe would call the public
     * path healthy without ever touching it. */
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compound-mcp-probe-'));

    /* ⛔ AND IT RUNS FROM A NEUTRAL DIRECTORY, NEVER THE REPO. Measured 2026-09-20: spawned
     * with cwd inside this package, npx reads the local package.json, sees it declares a
     * `compound-mcp` bin, resolves the name to node_modules/.bin/compound-mcp, which does not
     * exist because the package is not installed into itself, and dies with
     * "sh: compound-mcp: command not found". The published tarball was fine the whole time.
     *
     * That is worth more than the one line that fixes it. A public path check run from inside
     * the source tree is not checking the public path, it is checking the checkout with extra
     * steps, and it can fail or PASS for reasons no user will ever encounter. The neutral cwd
     * is what makes this the same command a stranger runs. */
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'compound-mcp-probe-cwd-'));

    command = 'npx';
    args = ['-y', `compound-mcp@${receipt.published_version}`];
    spawnEnv = { ...spawnEnv, npm_config_cache: cacheDir, npm_config_update_notifier: 'false' };
    receipt.target_command = `npx -y compound-mcp@${receipt.published_version}`;
    receipt.target_cwd = cwd;
  } else {
    command = process.execPath;
    args = [path.join(ROOT, 'bin/compound-mcp.js')];
    receipt.target_command = `${command} bin/compound-mcp.js`;
  }

  // ── signal 3, reachability. Started first and awaited last, because it is independent of
  //    the protocol signals and must be recorded even when nothing will spawn. ─────────────
  const reachTargets = target === 'public' ? [NPM_REGISTRY, ...upstreams] : upstreams;
  const reachability = Promise.all(reachTargets.map((u) => probeUpstream(fetchImpl, u)));

  // ── signals 1, 2 and 4 ─────────────────────────────────────────────────────────────────
  let client = null;
  let transport = null;
  let childErr = '';
  try {
    const t0 = nowMs();
    transport = new StdioClientTransport({ command, args, env: spawnEnv, cwd, stderr: 'pipe' });
    client = new Client({ name: 'compound-mcp-health-probe', version: '1.0.0' });

    /* The child's stderr carries the only readable account of a spawn that died, and the SDK
     * hands back nothing but "Connection closed". Draining it is also what stops a chatty
     * child blocking on a full pipe nobody reads. */
    transport.stderr?.on('data', (d) => {
      childErr += String(d);
    });

    /* setProtocolVersion is the Transport hook the SDK calls with the NEGOTIATED version the
     * moment initialize returns (client/index.js:299 in sdk 1.30.0). Capturing it here records
     * what the two ends actually agreed on, rather than the version this probe hoped for. */
    let negotiated = null;
    transport.setProtocolVersion = (v) => {
      negotiated = v;
    };

    /* connect() performs the handshake. A target that spawns and then says nothing would wait
     * here forever without this deadline, and a probe that never returns reports nothing. */
    await withTimeout(client.connect(transport), handshakeTimeoutMs, 'initialize timed out');
    const initMs = nowMs() - t0;

    const info = client.getServerVersion() || {};
    receipt.signals.initialize = passed({
      ms: initMs,
      protocol_version: negotiated,
      server_name: info.name ?? null,
      server_version: info.version ?? null,
      /* The version a client actually reads is the one initialize returns, and it has been a
       * minor behind package.json in this repo before while npm, server.json and the registry
       * all agreed. Recorded as context on the signal, never folded into its ok. */
      version_matches_repo: info.version != null && info.version === receipt.repo_version,
    });
  } catch (e) {
    const tail = childErr.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
    receipt.signals.initialize = failed(
      tail ? `${String(e?.message || e)} (child stderr: ${tail})` : String(e?.message || e),
    );
  }

  if (receipt.signals.initialize.ok) {
    // ── signal 2, the capability lookup ──────────────────────────────────────────────────
    try {
      const t0 = nowMs();
      const { tools } = await withTimeout(client.listTools(), callTimeoutMs, 'tools/list timed out');
      const ms = nowMs() - t0;
      const names = (tools || []).map((t) => t.name);
      if (names.length === 0) {
        /* An empty list is a 200 full of nothing. To the agent it is identical to a server
         * that does not work, so it is a failure here and not a zero. */
        receipt.signals.tools_list = failed('tools/list returned an empty list', { ms, tool_count: 0, tools: [] });
      } else {
        receipt.signals.tools_list = passed({ ms, tool_count: names.length, tools: names });
      }
    } catch (e) {
      receipt.signals.tools_list = failed(String(e?.message || e));
    }

    // ── signal 4, the outcome. Runs whatever tools/list said, because a tool that is
    //    advertised and does not answer is the exact gap this separates out. ──────────────
    if (toolCases.length === 0) {
      receipt.signals.tool_outcome = passed({ probes: [], note: 'no tool cases requested' });
    } else {
      const probes = [];
      for (const c of toolCases) {
        const t0 = nowMs();
        try {
          const res = await withTimeout(
            client.callTool({ name: c.tool, arguments: c.args }),
            callTimeoutMs,
            `${c.tool} timed out`,
          );
          const ms = nowMs() - t0;
          if (res.isError) {
            probes.push({ tool: c.tool, ms, ...failed(`isError: ${String(res.content?.[0]?.text || '').slice(0, 160)}`) });
            continue;
          }
          const text = res.content?.[0]?.text;
          if (!text) {
            probes.push({ tool: c.tool, ms, ...failed('returned no text content') });
            continue;
          }
          let payload;
          try {
            payload = JSON.parse(text);
          } catch (err) {
            probes.push({ tool: c.tool, ms, ...failed(`payload is not JSON: ${String(err.message).slice(0, 100)}`) });
            continue;
          }
          /* A tool that returns {error: "..."} is a 200 carrying a failure. directories.js
           * turns every upstream throw into exactly that shape on purpose, so reading only
           * isError would call a dead upstream a working tool. */
          if (payload && payload.error) {
            probes.push({ tool: c.tool, ms, ...failed(`tool returned an error payload: ${String(payload.error).slice(0, 160)}`) });
            continue;
          }
          if (c.expect && !(c.expect in payload)) {
            probes.push({ tool: c.tool, ms, ...failed(`payload is missing the promised key "${c.expect}"`) });
            continue;
          }
          probes.push({ tool: c.tool, ms, ...passed() });
        } catch (e) {
          probes.push({ tool: c.tool, ms: nowMs() - t0, ...failed(String(e?.message || e)) });
        }
      }
      const bad = probes.filter((p) => !p.ok);
      receipt.signals.tool_outcome = bad.length
        ? failed(`${bad.length} of ${probes.length} tool call(s) did not answer`, { probes })
        : passed({ probes });
    }
  } else {
    /* The protocol requires the handshake first, so these genuinely could not run. That is
     * recorded as a failure carrying what blocked it, never as a skip. A skip reads as a pass
     * on every dashboard that has ever been built. */
    receipt.signals.tools_list = failed('not attempted, initialize failed', { blocked_by: 'initialize' });
    receipt.signals.tool_outcome = failed('not attempted, initialize failed', { blocked_by: 'initialize' });
  }

  try {
    await client?.close();
  } catch {
    /* closing a transport that never opened is not a finding */
  }
  if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
  if (cwd) fs.rmSync(cwd, { recursive: true, force: true });

  // ── land reachability ──────────────────────────────────────────────────────────────────
  const probes = await reachability;
  const badUpstreams = probes.filter((p) => !p.ok);
  receipt.signals.reachable = badUpstreams.length
    ? failed(`${badUpstreams.length} of ${probes.length} endpoint(s) unreachable: ${badUpstreams.map((p) => p.name).join(', ')}`, {
        checked: probes.length,
        failed_count: badUpstreams.length,
        probes,
      })
    : passed({ checked: probes.length, failed_count: 0, probes });

  receipt.failing = Object.entries(receipt.signals)
    .filter(([, s]) => !s.ok)
    .map(([name]) => name);
  receipt.duration_ms = nowMs() - started;
  return receipt;
}

function withTimeout(p, ms, message) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(message)), ms);
    }),
  ]);
}

/** Keep the dated receipts. Request 2 asked for retention, so they are files, not a log line. */
function writeReceipt(receipt) {
  fs.mkdirSync(RECEIPTS, { recursive: true });
  const stamp = receipt.checked_at.replace(/[:.]/g, '-');
  const file = path.join(RECEIPTS, `${stamp}.${receipt.target}.json`);
  const body = JSON.stringify(receipt, null, 2);
  fs.writeFileSync(file, body);
  fs.writeFileSync(path.join(RECEIPTS, `latest.${receipt.target}.json`), body);
  const kept = fs
    .readdirSync(RECEIPTS)
    .filter((f) => f.endsWith('.json') && !f.startsWith('latest.'))
    .sort();
  for (const f of kept.slice(0, Math.max(0, kept.length - KEEP_RECEIPTS))) {
    fs.rmSync(path.join(RECEIPTS, f), { force: true });
  }
  return file;
}

function render(receipt) {
  const mark = (s) => (s.ok ? 'PASS' : 'FAIL');
  const lines = [];
  lines.push(`compound-mcp health  target=${receipt.target}  ${receipt.checked_at}`);
  lines.push(`  ${receipt.target_command}`);
  if (receipt.published_version) lines.push(`  published ${receipt.published_version}, repo ${receipt.repo_version}`);
  lines.push('');
  const i = receipt.signals.initialize;
  lines.push(`  initialize     ${mark(i)}  ${i.ok ? `${i.ms}ms, ${i.server_name} ${i.server_version}` : i.reason}`);
  const t = receipt.signals.tools_list;
  lines.push(`  tools_list     ${mark(t)}  ${t.ok ? `${t.ms}ms, ${t.tool_count} tools` : t.reason}`);
  const r = receipt.signals.reachable;
  lines.push(`  reachable      ${mark(r)}  ${r.ok ? `${r.checked} endpoints` : r.reason}`);
  for (const p of r.probes || []) {
    if (!p.ok) lines.push(`      FAIL ${p.name}  ${p.reason}`);
  }
  const o = receipt.signals.tool_outcome;
  lines.push(`  tool_outcome   ${mark(o)}  ${o.ok ? `${(o.probes || []).length} calls answered` : o.reason}`);
  for (const p of o.probes || []) {
    if (!p.ok) lines.push(`      FAIL ${p.tool}  ${p.reason}`);
  }
  lines.push('');
  lines.push(receipt.failing.length ? `  FAILING: ${receipt.failing.join(', ')}` : '  all four signals passed');
  return lines.join('\n');
}

function notify(receipt) {
  if (!receipt.failing.length || !fs.existsSync(NOTICES)) return;
  const detail = receipt.failing
    .map((n) => `${n}: ${receipt.signals[n].reason}`)
    .join(' | ');
  try {
    execFileSync(
      'python3',
      [
        NOTICES, 'add',
        '--source', 'compound-mcp',
        '--lane', 'mcp-health',
        '--summary', `compound-mcp ${receipt.target}: ${receipt.failing.join(', ')} failing`,
        '--detail', detail.slice(0, 900),
      ],
      { stdio: 'ignore' },
    );
  } catch {
    /* a dead notices helper must never take the probe down with it */
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const target = flag('--target', 'local');
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');

  let receipt;
  try {
    receipt = await probe({ target, versionSpec: flag('--version', 'latest') });
  } catch (e) {
    /* The probe itself could not produce a verdict. That is the one case that exits 1 even
     * without --strict, because there is no finding to report, only an unreadable check. */
    console.error(`probe crashed: ${e?.stack || e}`);
    process.exit(1);
  }

  let file;
  try {
    file = writeReceipt(receipt);
  } catch (e) {
    console.error(`could not write the receipt: ${e?.message || e}`);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    console.log(render(receipt));
    console.log(`\n  receipt: ${path.relative(ROOT, file)}`);
  }

  notify(receipt);
  process.exit(strict && receipt.failing.length ? 1 : 0);
}
