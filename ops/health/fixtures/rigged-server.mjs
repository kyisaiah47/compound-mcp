#!/usr/bin/env node
// rigged-server.mjs, a deliberately breakable MCP stdio server.
//
// It exists for one reason. The probe next to it records initialize, tools/list and external
// reachability as three independent facts, and that separation is only worth having if each
// one can actually fail on its own. A test that cannot break them one at a time proves
// nothing about the separation, it only proves the happy path still works.
//
// So this fixture speaks raw newline delimited JSON-RPC over stdio, which is what the MCP
// stdio transport is, and FIXTURE_MODE decides where it breaks:
//
//   ok             every method answers. The baseline.
//   no-init        initialize returns a JSON-RPC error. Nothing downstream can run.
//   no-tools       initialize SUCCEEDS and tools/list returns an error. This is the case a
//                  single health endpoint hides: the server is up, the handshake is fine,
//                  and the agent still gets no tools.
//   empty-tools    initialize and tools/list both succeed and the tool list is empty. A 200
//                  full of nothing, which type checks and reads as "no tools for you".
//   list-but-broken  tools/list advertises the tool, tools/call returns isError. Capability
//                  and outcome disagreeing, which is exactly the split request 2 asked for.
//   hang           accepts the connection and never answers. Proves a timeout is recorded as
//                  a failure rather than sitting forever.
//
// The SDK is deliberately not imported here. A fixture built on the same library as the thing
// it tests can only fail in ways that library allows, and the failures worth rehearsing are
// the ones a real broken deploy produces.

const MODE = process.env.FIXTURE_MODE || 'ok';

const TOOL = {
  name: 'echo_ok',
  title: 'Echo a fixed payload',
  description: 'Returns a fixed payload. No network, no upstream, no state.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(msg) {
  const { id, method, params } = msg;

  // A notification carries no id and gets no reply, ever. Answering one desynchronises the
  // client, which then looks like a protocol bug in the thing under test.
  if (id === undefined || id === null) return;

  if (MODE === 'hang') return;

  switch (method) {
    case 'initialize':
      if (MODE === 'no-init') {
        return error(id, -32603, 'rigged: initialize refused');
      }
      // Echo the client's own protocol version back. A server that invents one gets rejected
      // by the client for a reason that has nothing to do with what is being tested here.
      return result(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'rigged-server', version: '0.0.0-fixture' },
      });

    case 'ping':
      return result(id, {});

    case 'tools/list':
      if (MODE === 'no-tools') {
        return error(id, -32603, 'rigged: tools/list refused');
      }
      if (MODE === 'empty-tools') {
        return result(id, { tools: [] });
      }
      return result(id, { tools: [TOOL] });

    case 'tools/call': {
      if (MODE === 'list-but-broken') {
        return result(id, {
          content: [{ type: 'text', text: 'rigged: the tool is advertised and does not work' }],
          isError: true,
        });
      }
      return result(id, {
        content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        structuredContent: { ok: true },
      });
    }

    default:
      return error(id, -32601, `rigged: no handler for ${method}`);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      /* a malformed frame is the client's problem, not something to crash on */
    }
  }
});
process.stdin.on('end', () => process.exit(0));
