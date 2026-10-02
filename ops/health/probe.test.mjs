#!/usr/bin/env node
// ops/health/probe.test.mjs, the proof that the signals are actually independent.
//
//   node ops/health/probe.test.mjs
//
// ⛔ WHY THIS FILE IS THE POINT AND NOT A FORMALITY.
//
// The probe next to it records initialize, tools/list and external reachability apart from
// each other. That separation is worth exactly nothing if they cannot fail apart from each
// other, and "they are separate variables in the source" is not evidence of that. A single
// health endpoint that ANDs three conditions also has three conditions in its source.
//
// So every case here breaks ONE thing and asserts the other signals still pass. If a future
// edit quietly couples them, for instance by short circuiting the reachability probe when the
// handshake fails, these go red. Nothing else in the repo would notice.
//
// Hermetic on purpose. The fixture answers from memory with no network, and fetch is stubbed,
// so this proves the probe's LOGIC and never the health of an upstream. The real endpoints are
// what `node ops/health/probe.mjs` is for, and conflating the two gives you a unit test that
// fails when someone else's server is down.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { probe } from './probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/rigged-server.mjs');

/** A fetch that always answers, so reachability passes without touching the network. */
const fetchOk = async () => ({
  ok: true,
  status: 200,
  text: async () => '{"ok":true}',
  json: async () => ({ ok: true }),
});

/** A fetch that always dies, so reachability fails and nothing else does. */
const fetchDead = async () => {
  throw new Error('stubbed network failure');
};

const ECHO = [{ tool: 'echo_ok', args: {}, expect: 'ok' }];
const UP = [{ name: 'stub', url: 'https://stub.invalid/health' }];

/** Run the probe against the fixture in a given mode. */
const run = (mode, opts = {}) =>
  probe({
    command: process.execPath,
    args: [FIXTURE],
    env: { FIXTURE_MODE: mode },
    fetchImpl: fetchOk,
    upstreams: UP,
    toolCases: ECHO,
    handshakeTimeoutMs: 8_000,
    callTimeoutMs: 8_000,
    ...opts,
  });

const failures = [];
const check = (label, cond, got) => {
  if (cond) return;
  failures.push(`${label}\n      got: ${got}`);
};
const shape = (r) =>
  Object.entries(r.signals)
    .map(([k, v]) => `${k}=${v.ok ? 'PASS' : 'FAIL'}`)
    .join(' ');

const CASES = [
  {
    title: 'baseline: everything healthy leaves `failing` empty',
    run: () => run('ok'),
    assert: (r) => [
      ['no signal is reported failing', r.failing.length === 0],
      ['initialize passed', r.signals.initialize.ok],
      ['tools_list passed', r.signals.tools_list.ok],
      ['reachable passed', r.signals.reachable.ok],
      ['tool_outcome passed', r.signals.tool_outcome.ok],
    ],
  },
  {
    title: 'initialize fails ALONE: reachability is still recorded and still passes',
    run: () => run('no-init'),
    assert: (r) => [
      ['initialize failed', !r.signals.initialize.ok],
      ['reachable is independent and passed', r.signals.reachable.ok],
      ['reachable was actually probed, not skipped', r.signals.reachable.checked === 1],
      ['tools_list failed and names what blocked it', r.signals.tools_list.blocked_by === 'initialize'],
      ['`failing` names initialize', r.failing.includes('initialize')],
    ],
  },
  {
    /* The case a single health endpoint cannot express. The server is up, the handshake is
     * clean, tool calls work, and the agent still gets no tools. One boolean would report this
     * as "down" and send the repair to the wrong place. */
    title: 'tools_list fails ALONE: initialize, reachability and tool calls all still pass',
    run: () => run('no-tools'),
    assert: (r) => [
      ['initialize passed', r.signals.initialize.ok],
      ['tools_list failed', !r.signals.tools_list.ok],
      ['reachable passed', r.signals.reachable.ok],
      ['tool_outcome passed', r.signals.tool_outcome.ok],
      ['`failing` is exactly [tools_list]', r.failing.length === 1 && r.failing[0] === 'tools_list'],
    ],
  },
  {
    title: 'reachable fails ALONE: the protocol signals all still pass',
    run: () => run('ok', { fetchImpl: fetchDead }),
    assert: (r) => [
      ['initialize passed', r.signals.initialize.ok],
      ['tools_list passed', r.signals.tools_list.ok],
      ['tool_outcome passed', r.signals.tool_outcome.ok],
      ['reachable failed', !r.signals.reachable.ok],
      ['`failing` is exactly [reachable]', r.failing.length === 1 && r.failing[0] === 'reachable'],
      ['the failing endpoint is named', (r.signals.reachable.reason || '').includes('stub')],
    ],
  },
  {
    /* Request 2, @jithox.bsky.social: keep capability lookup separate from the outcome. This is
     * the shape lookup_nonprofit_status shipped in for weeks. */
    title: 'capability and outcome disagree: tools_list passes while tool_outcome fails',
    run: () => run('list-but-broken'),
    assert: (r) => [
      ['tools_list passed, the capability is advertised', r.signals.tools_list.ok],
      ['the tool is in the advertised list', (r.signals.tools_list.tools || []).includes('echo_ok')],
      ['tool_outcome failed, calling it does not work', !r.signals.tool_outcome.ok],
      ['`failing` is exactly [tool_outcome]', r.failing.length === 1 && r.failing[0] === 'tool_outcome'],
    ],
  },
  {
    title: 'an empty tool list is a FAILURE, never a zero that reads as healthy',
    run: () => run('empty-tools', { toolCases: [] }),
    assert: (r) => [
      ['initialize passed', r.signals.initialize.ok],
      ['tools_list failed on the empty list', !r.signals.tools_list.ok],
      ['the count is recorded as 0', r.signals.tools_list.tool_count === 0],
    ],
  },
  {
    title: 'fail closed: a server that never answers times out as a FAILURE',
    run: () => run('hang', { handshakeTimeoutMs: 2_000 }),
    assert: (r) => [
      ['initialize failed rather than hanging', !r.signals.initialize.ok],
      ['the reason says it timed out', /timed out/i.test(r.signals.initialize.reason || '')],
      ['reachability was still recorded', r.signals.reachable.ok],
    ],
  },
  {
    title: 'fail closed: a target that cannot spawn at all is a FAILURE with a reason',
    run: () =>
      run('ok', { command: '/nonexistent/openlookup-does-not-exist', args: [], handshakeTimeoutMs: 8_000 }),
    assert: (r) => [
      ['initialize failed', !r.signals.initialize.ok],
      ['a reason was recorded', Boolean(r.signals.initialize.reason)],
      ['nothing downstream was marked passing', !r.signals.tools_list.ok && !r.signals.tool_outcome.ok],
    ],
  },
  {
    title: 'the receipt is dated and says what was checked',
    run: () => run('ok'),
    assert: (r) => [
      ['checked_at is a real ISO instant', !Number.isNaN(Date.parse(r.checked_at))],
      ['the command that was run is recorded', Boolean(r.target_command)],
      ['every reachability probe carries its own url', (r.signals.reachable.probes || []).every((p) => p.url)],
      ['`failing` is a list of names, not a boolean', Array.isArray(r.failing)],
    ],
  },
];

console.log('openlookup health probe, signal independence\n');

for (const c of CASES) {
  let r;
  try {
    r = await c.run();
  } catch (e) {
    failures.push(`${c.title}\n      threw: ${e?.stack || e}`);
    console.log(`  THREW  ${c.title}`);
    continue;
  }
  const results = c.assert(r);
  const bad = results.filter(([, ok]) => !ok);
  for (const [label] of bad) check(`${c.title}\n      assertion: ${label}`, false, shape(r));
  console.log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${c.title}`);
  console.log(`          ${shape(r)}`);
}

console.log('');
if (failures.length) {
  console.error(`${failures.length} assertion(s) failed:\n`);
  for (const f of failures) console.error(`    ${f}\n`);
  process.exit(1);
}
console.log(`${CASES.length} cases passed. Each of the three signals was broken on its own and the`);
console.log('others kept reporting, so the separation is load bearing and not decorative.');
