import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { createInvitation, parseInvitation, createCode, parseCode, INVITATION_MS } from '../dist/crypto.js';
import { InvitationHost, InvitationJoin } from '../dist/short-pairing.js';
import { createRelay } from '../dist/relay.js';
import { Peer } from '../dist/peer.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('nine-letter codes normalize presentation while long credentials stay separate', () => {
  for (let i = 0; i < 20; i++) assert.match(createInvitation(), /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/);
  const parsed = parseInvitation(' ABC def-GHI '); assert.equal(parsed.room, 'S2.ab'); assert.equal(parsed.secret.toString(), 'cdefghi'); assert.equal(parsed.short, true);
  assert.deepEqual(parseInvitation('abcdefghi'), parsed); assert.throws(() => parseCode('abc-def-ghi'));
  for (const invalid of ['abc-def-gh', 'abc-def-ghij', 'abc-123-ghi', 'ábć-def-ghi']) assert.throws(() => parseInvitation(invalid));
  const legacy = createCode(); assert.equal(parseInvitation(legacy).short, false); assert.equal(parseCode(legacy).secret.length, 32);
});

test('OPAQUE yields matching strong keys, rejects wrong passwords and binds the invitation locator', () => {
  const host = new InvitationHost('S2.ab', Buffer.from('cdefghi'));
  const wrong = new InvitationJoin('S2.ab', Buffer.from('xxxxxxx'));
  assert.throws(() => wrong.finish(host.start(wrong.start())), /invitation|login|authentication/i); host.reset();
  const otherRoom = new InvitationJoin('S2.cd', Buffer.from('cdefghi'));
  assert.throws(() => otherRoom.finish(host.start(otherRoom.start()))); host.reset();
  const correct = new InvitationJoin('S2.ab', Buffer.from('cdefghi'));
  const final = correct.finish(host.start(correct.start())); const secret = host.finish(final.reply);
  assert.equal(secret.length, 32); assert.ok(secret.equals(final.secret)); assert.throws(() => host.finish(final.reply));
  host.destroy(); correct.destroy(); wrong.destroy(); otherRoom.destroy();
});

test('short pairing requires local approval, is one-time, and provisions a separate long reconnect credential', { timeout: 15000 }, async () => {
  const frames: Buffer[] = [], relay = createRelay({ port: 0, observeCiphertext: bytes => frames.push(Buffer.from(bytes)) });
  const url = 'ws://127.0.0.1:' + await relay.listen(), code = createInvitation(), credential = createCode();
  let prompts = 0;
  const host = new Peer({ role: 'host', code, relay: url, provision: () => credential, accept: async ({ remember }) => { prompts++; assert.equal(remember, true); return true; } }); await host.open();
  const join = new Peer({ role: 'join', code: code.toUpperCase().replaceAll('-', ' '), relay: url, remember: true });
  try {
    await join.open(); await host.active; assert.equal(prompts, 1); assert.equal(join.rememberedCode, credential); assert.equal(join.fingerprint, host.fingerprint);
    const reuse = new Peer({ role: 'join', code, relay: url }); await assert.rejects(reuse.open()); reuse.close();
    assert.ok(!Buffer.concat(frames).includes(Buffer.from(code))); assert.ok(!Buffer.concat(frames).includes(Buffer.from(credential)));
  } finally { join.close(); host.close(); await relay.close(); }
});

test('wrong secret never reaches approval and a corrected code can still pair', { timeout: 15000 }, async () => {
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen(), code = 'abc-def-ghi'; let prompts = 0;
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => { prompts++; return true; } }); await host.open();
  const wrong = new Peer({ role: 'join', code: 'abx-xxx-xxx', relay: url });
  try { await assert.rejects(wrong.open()); assert.equal(prompts, 0); await wait(50); const correct = new Peer({ role: 'join', code, relay: url }); try { await correct.open(); assert.equal(prompts, 1); } finally { correct.close(); } }
  finally { wrong.close(); host.close(); await relay.close(); }
});

test('invitation expiration is enforced by the probe even when the relay keeps the room', { timeout: 5000 }, async () => {
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen();
  const host = new Peer({ role: 'host', code: createInvitation(), relay: url, invitationMs: 100 });
  try { await host.open(); assert.match(await host.ended, /expired/); } finally { host.close(); await relay.close(); }
});

test('relay rejects an expired invitation before its periodic cleanup', { timeout: 5000 }, async () => {
  const relay = createRelay({ port: 0, invitationMs: 30 }), url = 'ws://127.0.0.1:' + await relay.listen(), code = createInvitation();
  const host = new Peer({ role: 'host', code, relay: url }); await host.open(); await wait(60);
  const join = new Peer({ role: 'join', code, relay: url });
  try { await assert.rejects(join.open()); } finally { join.close(); host.close(); await relay.close(); }
});

test('default short invitations pair after 30 minutes and expire at two hours', { timeout: 10000 }, async t => {
  assert.equal(INVITATION_MS, 120 * 60_000);
  const start = Date.now();
  let now = start;
  t.mock.method(Date, 'now', () => now);
  const relay = createRelay({ port: 0 });
  const url = 'ws://127.0.0.1:' + await relay.listen();
  const first = new Peer({ role: 'host', code: 'abc-def-ghi', relay: url, accept: async () => true });
  const second = new Peer({ role: 'host', code: 'xyz-abc-def', relay: url, accept: async () => true });
  let joiner: Peer | undefined;
  let expired: Peer | undefined;
  try {
    await first.open();
    await second.open();
    now = start + 31 * 60_000;
    joiner = new Peer({ role: 'join', code: 'abc-def-ghi', relay: url });
    await joiner.open();
    now = start + 120 * 60_000;
    expired = new Peer({ role: 'join', code: 'xyz-abc-def', relay: url });
    await assert.rejects(expired.open());
  } finally {
    joiner?.close();
    expired?.close();
    first.close();
    second.close();
    await relay.close();
  }
});

test('probe limits attempts even if a malicious relay keeps resetting the handshake', { timeout: 10000 }, async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const url = 'ws://127.0.0.1:' + (server.address() as { port: number }).port; let rejected = 0;
  server.on('connection', ws => {
    const attempt = () => { ws.send(JSON.stringify({ type: 'peer' })); ws.send(Buffer.from('invalid PAKE'), { binary: true }); };
    ws.on('message', (_data, binary) => {
      if (binary) return;
      const message = JSON.parse(_data.toString());
      if (message.role) { ws.send(JSON.stringify({ type: 'registered' })); attempt(); }
      else if (message.type === 'reject') { rejected++; attempt(); }
    });
  });
  const host = new Peer({ role: 'host', code: createInvitation(), relay: url, accept: async () => { throw new Error('Must never request approval'); } });
  try { await host.open(); assert.match(await host.ended, /attempt limit/); assert.equal(rejected, 4); }
  finally { host.close(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('locator collisions are explicit and never replace the first probe', { timeout: 5000 }, async () => {
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen();
  const first = new Peer({ role: 'host', code: 'abc-def-ghi', relay: url, accept: async () => true }); await first.open();
  const second = new Peer({ role: 'host', code: 'abx-xxx-xxx', relay: url });
  try { await assert.rejects(second.open(), /locator occupied/); const join = new Peer({ role: 'join', code: 'abc-def-ghi', relay: url }); try { await join.open(); } finally { join.close(); } }
  finally { second.close(); first.close(); await relay.close(); }
});

test('session idle and lifetime clocks start after pairing, not while the code is waiting', { timeout: 5000 }, async () => {
  const { ProbeEngine } = await import('../dist/engine.js'), { Audit } = await import('../dist/util.js');
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'diagnose-short-idle-'));
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen(), code = createInvitation();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  new ProbeEngine(host, async () => false, new Audit(join(root, 'audit')), () => {}, { idleMs: 40, lifetimeMs: 100 }); await host.open(); await wait(150);
  const joiner = new Peer({ role: 'join', code, relay: url });
  try { await joiner.open(); assert.equal(await host.ended, 'Idle timeout'); }
  finally { joiner.close(); host.close(); await relay.close(); await rm(root, { recursive: true, force: true }); }
});

test('relay renews the locked room on encrypted traffic past six hours and expires a silent room', { timeout: 10000 }, async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen(), code = createInvitation();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  let joiner: Peer | undefined;
  try {
    await host.open();
    joiner = new Peer({ role: 'join', code, relay: url });
    await joiner.open();
    await host.active;
    for (let round = 0; round < 3; round++) {
      now += 5 * 60 * 60_000;
      const received = once(host, 'message');
      await joiner.send({ type: 'task.cancel', id: '26155a8b-c35a-436e-948a-9797732e6259' });
      assert.equal((await received)[0].type, 'task.cancel');
    }
    now += 6 * 60 * 60_000;
    await joiner.send({ type: 'ping' });
    assert.equal(await host.ended, 'Relay session expired');
    assert.equal(await joiner.ended, 'Relay session expired');
  } finally { joiner?.close(); host.close(); await relay.close(); }
});

test('normal heartbeat is not diagnostic activity but an explicit result poll is', { timeout: 5000 }, async () => {
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen(), code = createInvitation();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  await host.open();
  const joiner = new Peer({ role: 'join', code, relay: url });
  let activity = 0;
  host.on('activity', () => { activity++; });
  try {
    await joiner.open();
    await joiner.send({ type: 'ping' });
    assert.equal(activity, 0);
    const touched = once(host, 'activity');
    await joiner.send({ type: 'ping', activity: true });
    await touched;
    assert.equal(activity, 1);
  } finally { joiner.close(); host.close(); await relay.close(); }
});
