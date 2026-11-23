import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createRelay } from '../dist/relay.js';
import { Peer } from '../dist/peer.js';
import { Operator } from '../dist/operator.js';

test('desktop bridge localizes consent and ends a diagnostic session on window close', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'diagnose-desktop-'));
  const relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`;
  const child = spawn(process.env.DIAGNOSE_TEST_NODE ?? process.execPath, [process.env.DIAGNOSE_TEST_CLI ?? 'dist/cli.js', 'start', url, '--desktop-stdio', '--lang', 'es'], {
    env: { ...process.env, HOME: root, USERPROFILE: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const events: { event: string; text: string; code?: string }[] = [];
  lines.on('line', line => { if (line.startsWith('\x1e')) events.push(JSON.parse(line.slice(1))); });
  child.stderr.resume();
  const until = async (event: string) => {
    for (let i = 0; i < 200; i++) {
      const found = events.find(value => value.event === event);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`No ${event} event. Seen: ${events.map(value => value.event).join(', ')}`);
  };
  let peer: Peer | undefined;
  try {
    assert.match((await until('startup')).text, /aprobar todo/);
    child.stdin.write('\n');
    const invitation = await until('code');
    assert.match(invitation.text, /Código de conexión/);
    peer = new Peer({ role: 'join', code: invitation.code!, relay: url });
    await peer.open();
    assert.match((await until('connected')).text, /Conexión establecida/);
    const result = await new Operator(peer).run({ operation: 'system.inspect', arguments: {}, reason: 'Read probe inventory' });
    assert.equal(result.result.status, 'ok');
    const exited = once(child, 'exit');
    child.stdin.end();
    assert.equal(await peer.ended, 'User ended session');
    assert.equal((await exited)[0], 0);
  } finally {
    peer?.close();
    lines.close();
    if (child.exitCode === null) child.kill();
    await relay.close();
  }
});
