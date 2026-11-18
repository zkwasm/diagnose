import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairingStore, automatic, RememberedConnection } from '../dist/pairing.js';
import { createCode } from '../dist/crypto.js';
import { createRelay } from '../dist/relay.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Audit } from '../dist/util.js';
const scratch = () => mkdtempSync(join(tmpdir(), 'diagnose-pairing-'));

test('pairing credentials survive restart encrypted; grants expire by wall clock; deletion revokes local record', () => {
  const root = scratch(), store = new PairingStore(root), code = createCode();
  const value = store.add({ role: 'operator', name: 'alice-pc', code, relay: 'https://diagnose.fenginwind.com', label: 'support / AI' });
  value.autoUntil = 2000; store.save(value);
  assert.equal(automatic(value, 1999), true); assert.equal(automatic(value, 2000), false);
  value.autoUntil = null; assert.equal(automatic(value), true); value.paused = true; assert.equal(automatic(value), false);
  const restarted = new PairingStore(root); assert.equal(restarted.get('alice-pc', 'operator').code, code);
  for (const name of readdirSync(root).filter(name => name.endsWith('.meta'))) { assert.equal(readFileSync(join(root, name)).includes(Buffer.from(code)), false); if (process.platform !== 'win32') assert.equal(statSync(join(root, name)).mode & 0o777, 0o600); }
  assert.throws(() => store.add({ ...value, name: 'alice-pc' }));
  restarted.remove(value.id); assert.deepEqual(store.list(), []);
});

test('remembered connection reconnects with fresh encryption and never replays a command', { timeout: 15000 }, async () => {
  const root = scratch(), frames: Buffer[] = [], relay = createRelay({ port: 0, observeCiphertext: bytes => frames.push(Buffer.from(bytes)) });
  const url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode();
  const record = new PairingStore(root).add({ role: 'operator', name: 'alice', label: 'test', relay: url, code });
  const connection = new RememberedConnection(record, 3000);
  let approvals = 0;
  const host = () => { const peer = new Peer({ role: 'host', code, relay: url, accept: async () => true }); new ProbeEngine(peer, async () => { approvals++; return true; }, new Audit(join(root, `audit-${Math.random()}`))); return peer; };
  let probe = host(); await probe.open();
  try {
    const first = await connection.connect(), fingerprint = first.peer.fingerprint;
    const result = await first.run({ operation: 'system.inspect', arguments: {}, reason: 'First task' }); assert.equal(result.result.status, 'ok');
    first.peer.close(); await probe.ended; probe.close(); await new Promise(resolve => setTimeout(resolve, 80));
    probe = host(); await probe.open();
    const second = await connection.connect(); assert.notEqual(second, first); assert.notEqual(second.peer.fingerprint, fingerprint);
    assert.equal(approvals, 2, 'reconnection must not replay completed task');
    assert.equal((await second.run({ operation: 'system.inspect', arguments: {}, reason: 'Second task' })).result.status, 'ok'); assert.equal(approvals, 4);
    assert.equal(Buffer.concat(frames).includes(Buffer.from(code)), false);
    connection.close(); await assert.rejects(connection.connect(), /ended/);
  } finally { connection.close(); probe.close(); await relay.close(); }
});

test('actual host survives probe and relay restarts, pauses access, and revokes pairing', { skip: process.platform !== 'darwin', timeout: 25000 }, async () => {
  const { spawn } = await import('node:child_process'); const { resolve } = await import('node:path');
  const root = scratch(); let relay = createRelay({ port: 0 }); const port = await relay.listen(), url = `ws://127.0.0.1:${port}`;
  let output = '', pairPrompts = 0;
  const start = () => {
    const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'remember-test', process.execPath, resolve('dist/cli.js'), 'start', url], { detached: true, env: { ...process.env, HOME: root }, stdio: ['pipe', 'pipe', 'pipe'] });
    let startup = false;
    child.stderr.resume(); child.stdout.on('data', bytes => {
      output += bytes.toString();
      if (!startup && output.includes('Task approval for the next session?')) { startup = true; child.stdin.write('e\n'); }
      if (output.includes('Remember and allow this diagnostician?') && !pairPrompts) { pairPrompts++; child.stdin.write('a\n'); }
    }); return child;
  };
  let child = start(), peer: Peer | undefined;
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 300 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(predicate(), output); };
  const stop = async () => { const ended = new Promise(resolve => child.once('exit', resolve)); if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} await ended; };
  try {
    await until(() => /\b[a-z]{3}-[a-z]{3}-[a-z]{3}\b/.test(output));
    const invitation = output.match(/\b[a-z]{3}-[a-z]{3}-[a-z]{3}\b/)![0];
    peer = new Peer({ role: 'join', code: invitation, relay: url, label: 'Remembered support / test AI', remember: true }); await peer.open();
    const credential = peer.rememberedCode!; assert.ok(credential); assert.notEqual(credential, invitation);
    peer.close(); await until(() => output.includes('Waiting for connections'));
    const store = new PairingStore(join(root, '.diagnose', 'pairings')); const record = store.list('host')[0]; assert.equal(record.code, credential);
    await stop(); output = ''; child = start(); await until(() => output.includes('Waiting for connections'));
    const connection = new RememberedConnection({ ...record, role: 'operator' }, 2000);
    let operator = await connection.connect(); assert.equal((await operator.run({ operation: 'system.inspect', arguments: {}, reason: 'Restart without pairing or approval' })).result.status, 'ok'); assert.equal(pairPrompts, 1);
    child.stdin.write('pause\n'); await until(() => output.includes('Remote access is paused'));
    await operator.peer.ended; await assert.rejects(connection.connect());
    child.stdin.write('resume\n'); await until(() => output.split('Waiting for connections').length >= 3);
    operator = await connection.connect(); assert.equal((await operator.run({ operation: 'system.inspect', arguments: {}, reason: 'Resume without a new code' })).result.status, 'ok');
    await relay.close(); await operator.peer.ended; relay = createRelay({ port }); await relay.listen();
    operator = await connection.connect(); assert.equal((await operator.run({ operation: 'system.inspect', arguments: {}, reason: 'Relay restarted; same pairing and unexpired permission' })).result.status, 'ok');
    child.stdin.write('unpair\n'); await operator.peer.ended; await until(() => output.includes('Pairing revoked'));
    assert.deepEqual(store.list('host'), []); await assert.rejects(connection.connect()); connection.close();
    assert.equal(output.includes(credential), false, 'durable credential must never be printed');
  } finally { peer?.close(); await stop(); await relay.close(); }
});

test('real MCP sessions reuse a saved device; a broken request is not replayed after reconnect', { timeout: 15000 }, async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js'); const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js'); const { resolve } = await import('node:path');
  const root = scratch(), relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode();
  new PairingStore(join(root, '.diagnose', 'pairings')).add({ role: 'operator', name: 'alice', label: 'test', relay: url, code });
  let count = 0;
  const host = () => { const peer = new Peer({ role: 'host', code, relay: url, accept: async () => true }); new ProbeEngine(peer, async () => true, new Audit(join(root, `audit-${Math.random()}`))); peer.on('message', message => { if (message.type === 'task.request') count++; }); return peer; };
  let probe = host(); await probe.open();
  const session = async () => { const client = new Client({ name: 'remembered-test', version: '1' }); await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp', '--device', 'alice'], env: { ...process.env, HOME: root } as Record<string, string>, stderr: 'pipe' })); return client; };
  const value = (result: any) => { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
  let client = await session();
  try {
    const task = value(await client.callTool({ name: 'diagnose_start', arguments: { operation: 'system.inspect', arguments: {}, reason: 'Saved device, no code' } })); assert.equal(value(await client.callTool({ name: 'diagnose_wait', arguments: { id: task.id, timeoutMs: 3000 } })).result.status, 'ok');
    await client.close(); await probe.ended; await new Promise(resolve => setTimeout(resolve, 80)); probe = host(); await probe.open(); client = await session();
    const slow = value(await client.callTool({ name: 'diagnose_start', arguments: { operation: 'process.script', arguments: { interpreter: process.execPath, script: 'setTimeout(()=>{},10000)' }, reason: 'Interrupt without replay' } }));
    probe.close(); await probe.ended; await new Promise(resolve => setTimeout(resolve, 80)); probe = host(); await probe.open();
    const next = value(await client.callTool({ name: 'diagnose_start', arguments: { operation: 'system.inspect', arguments: {}, reason: 'Reconnect for new work only' } })); assert.equal(value(await client.callTool({ name: 'diagnose_wait', arguments: { id: next.id, timeoutMs: 3000 } })).result.status, 'ok');
    assert.equal(count, 3); const lost = await client.callTool({ name: 'diagnose_wait', arguments: { id: slow.id } }); assert.equal(lost.isError, true);
  } finally { await client.close(); probe.close(); await relay.close(); }
});

test('pair CLI saves a separately provisioned credential and lists only safe metadata', { skip: process.platform !== 'darwin', timeout: 12000 }, async () => {
  const { spawn } = await import('node:child_process'); const { resolve } = await import('node:path');
  const root = scratch(), relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode(), credential = createCode();
  let requestedRemember = false;
  const host = new Peer({ role: 'host', code, relay: url, provision: () => credential, accept: async ({ remember }) => { requestedRemember = remember; return true; } }); await host.open();
  const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'pair-cli-test', process.execPath, resolve('dist/cli.js'), 'pair', url, '--name', 'alice-pc'], { detached: true, env: { ...process.env, HOME: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', stage = 0; child.stderr.resume(); child.stdout.on('data', bytes => { output += bytes.toString(); if (!stage && output.includes('Pairing code:')) { stage = 1; child.stdin.write(code + '\n'); } if (stage === 1 && output.includes('Your label')) { stage = 2; child.stdin.write('Support / AI provider\n'); } if (stage === 2 && output.includes('Paired. Start diagnosis')) { stage = 3; child.stdin.end(); } });
  const timer = setTimeout(() => { if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 8000);
  try {
    const exit = await new Promise(resolve => child.once('exit', resolve)); assert.equal(exit, 0, output); assert.equal(requestedRemember, true);
    const saved = new PairingStore(join(root, '.diagnose', 'pairings')).get('alice-pc', 'operator'); assert.equal(saved.code, credential); assert.equal(output.includes(credential), false);
    const listing = spawn(process.execPath, [resolve('dist/cli.js'), 'devices'], { env: { ...process.env, HOME: root } }); let metadata = ''; listing.stdout.on('data', bytes => metadata += bytes); await new Promise(resolve => listing.once('exit', resolve)); assert.equal(JSON.parse(metadata)[0].name, 'alice-pc'); assert.equal(metadata.includes(credential), false);
  } finally { clearTimeout(timer); host.close(); if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} await relay.close(); }
});

for (const lifetime of [-1, 1500]) test(`remembered auto grant (${lifetime > 0 ? 'timer expiry' : 'already expired'}) requires approval after probe restart`, { skip: process.platform !== 'darwin', timeout: 12000 }, async () => {
  const { spawn } = await import('node:child_process'); const { resolve } = await import('node:path');
  const root = scratch(), relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode();
  const store = new PairingStore(join(root, '.diagnose', 'pairings')), record = store.add({ role: 'host', name: 'diagnostician', label: 'test', relay: url, code }); record.autoUntil = Date.now() + lifetime; store.save(record);
  const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'expiry-test', process.execPath, resolve('dist/cli.js'), 'start', url], { detached: true, env: { ...process.env, HOME: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', prompts = 0; child.stderr.resume(); child.stdout.on('data', bytes => { output += bytes.toString(); if (output.includes('Allow exactly this operation?') && !prompts) { prompts++; child.stdin.write('n\n'); } });
  const connection = new RememberedConnection({ ...record, role: 'operator' }, 4000);
  try { const operator = await connection.connect(); if (lifetime > 0) { for (let i = 0; i < 150 && !output.includes('Permission mode: ask'); i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(output.includes('Permission mode: ask')); } const result = await operator.run({ operation: 'system.inspect', arguments: {}, reason: 'Expired auto must not renew' }); assert.equal(result.result.status, 'denied'); assert.equal(prompts, 1); assert.equal(output.includes('Pairing code ('), false); }
  finally { connection.close(); if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} await relay.close(); }
});
