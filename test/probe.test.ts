import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRelay } from '../dist/relay.js';
import { createCode, parseCode, Handshake } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Operator } from '../dist/operator.js';
import { Audit } from '../dist/util.js';
import { execute, prepareWrite } from '../dist/executor.js';
import { taskSchema, type ApprovalHandler } from '../dist/schema.js';

const dir = mkdtempSync(join(tmpdir(), 'diagnose-test-'));
async function session(approve: ApprovalHandler = async () => true) {
  const frames: Buffer[] = [];
  const relay = createRelay({ port: 0, observeCiphertext: bytes => frames.push(Buffer.from(bytes)) });
  const url = `ws://127.0.0.1:${await relay.listen()}`; const code = createCode();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  const audit = new Audit(join(dir, randomUUID() + '.jsonl'));
  new ProbeEngine(host, approve, audit); await host.open();
  const peer = new Peer({ role: 'join', code, relay: url }); const operator = new Operator(peer);
  await peer.open(); await host.active;
  return { host, peer, operator, audit, frames, code, async close() { peer.close(); host.close(); await relay.close(); } };
}

test('Noise authentication, channel binding, tampering and replay', () => {
  const { room, secret } = parseCode(createCode());
  const a = new Handshake(true, room, secret), b = new Handshake(false, room, secret);
  assert.equal(b.receive(a.send(Buffer.from('hello'))).toString(), 'hello');
  assert.equal(a.receive(b.send(Buffer.from('world'))).toString(), 'world');
  const ac = a.split(), bc = b.split(); assert.equal(ac.fingerprint, bc.fingerprint);
  const frame = ac.encrypt(Buffer.from('private')); assert.equal(bc.decrypt(frame).toString(), 'private');
  assert.throws(() => bc.decrypt(frame));
  const changed = ac.encrypt(Buffer.from('tamper')); changed[4] ^= 1; assert.throws(() => bc.decrypt(changed));
  ac.destroy(); bc.destroy();
  const bad = new Handshake(false, room, Buffer.alloc(32)); const fresh = new Handshake(true, room, secret);
  assert.throws(() => bad.receive(fresh.send(Buffer.alloc(0)))); bad.destroy(); fresh.destroy();
  const other = new Handshake(false, 'wrong-route', secret); const correct = new Handshake(true, room, secret);
  assert.throws(() => other.receive(correct.send(Buffer.alloc(0)))); other.destroy(); correct.destroy();
});

test('encrypted commands, large chunks, audit collection vs transfer, no relay plaintext', async () => {
  const s = await session();
  try {
    const value = 'PRIVATE_DIAGNOSTIC_MARKER';
    const result = await s.operator.run({ operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', `process.stdout.write('${value}'.repeat(10000))`] }, reason: 'Verify chunked diagnostics' });
    assert.equal(result.result.status, 'ok'); assert.equal(result.outputs.stdout, value.repeat(10000));
    const wire = Buffer.concat(s.frames);
    assert.equal(wire.includes(Buffer.from(value)), false); assert.equal(wire.includes(Buffer.from(parseCode(s.code).secret)), false);
    const audit = readFileSync(s.audit.path, 'utf8'); assert.ok(audit.indexOf('task.collected') < audit.indexOf('task.transfer-approved')); assert.ok(audit.includes('task.chunk-sending')); assert.equal(audit.includes(value), false);
  } finally { await s.close(); }
});

test('execution refusal and transfer refusal are enforced locally', async () => {
  const target = join(dir, 'must-not-exist');
  let mode = 'deny'; const s = await session(async request => mode === 'send-deny' && request.stage === 'execute');
  try {
    const denied = await s.operator.run({ operation: 'file.write', arguments: { path: target, content: 'never' }, reason: 'Test denial' });
    assert.equal(denied.result.status, 'denied'); assert.equal(existsSync(target), false);
    mode = 'send-deny';
    const local = await s.operator.run({ operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', 'console.log("LOCAL_ONLY_CONTENT")'] }, reason: 'Test transfer denial' });
    assert.equal(local.result.status, 'denied'); assert.deepEqual(local.outputs, {}); assert.equal(Buffer.concat(s.frames).includes(Buffer.from('LOCAL_ONLY_CONTENT')), false);
  } finally { await s.close(); }
});

test('cancellation, timeouts, file writes, and stale preview rejection', async () => {
  const s = await session();
  try {
    const id = await s.operator.start({ operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, reason: 'Cancel test process' });
    await new Promise(resolve => setTimeout(resolve, 150)); await s.operator.cancel(id);
    const outcome = await s.operator.wait(id, 5000); assert.equal('result' in outcome && outcome.result.status, 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 50));
    const timeout = await s.operator.run({ operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 }, reason: 'Timeout test' });
    assert.equal(timeout.result.error, 'Task timeout');
    const target = join(dir, 'write-test');
    const written = await s.operator.run({ operation: 'file.write', arguments: { path: target, content: 'test' }, reason: 'Write only temporary test file' }); assert.equal(written.result.status, 'ok'); assert.equal(readFileSync(target, 'utf8'), 'test');
    const read = await s.operator.run({ operation: 'file.read', arguments: { path: target }, reason: 'Read temporary test file' }); assert.equal(read.outputs.file, 'test');
    const task = taskSchema.parse({ id: randomUUID(), operation: 'file.write', arguments: { path: target, content: 'replacement' }, reason: 'Race test' });
    const snapshot = prepareWrite(task); writeFileSync(target, 'changed');
    await assert.rejects(execute(task, new AbortController().signal, snapshot), /changed/); assert.equal(readFileSync(target, 'utf8'), 'changed');
  } finally { await s.close(); }
});

test('wrong secret cannot consume invitation; host confirmation gates activation', async () => {
  const relay = createRelay({ port: 0 }); const url = `ws://127.0.0.1:${await relay.listen()}`; const code = createCode();
  let accept!: (value: boolean) => void; const decision = new Promise<boolean>(resolve => { accept = resolve; });
  const host = new Peer({ role: 'host', code, relay: url, accept: () => decision }); await host.open();
  const wrong = new Peer({ role: 'join', relay: url, code: `D1.${parseCode(code).room}.${Buffer.alloc(32).toString('base64url')}` });
  await assert.rejects(wrong.open()); await new Promise(resolve => setTimeout(resolve, 50));
  const peer = new Peer({ role: 'join', code, relay: url }); let active = false; peer.active.then(() => { active = true; });
  try { await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(active, false); accept(true); await peer.open(); assert.equal(active, true); }
  finally { peer.close(); wrong.close(); host.close(); await relay.close(); }
});

test('expired invitations and stalled local confirmation cannot activate a session', async () => {
  const relay = createRelay({ port: 0, invitationMs: 30 }); const url = `ws://127.0.0.1:${await relay.listen()}`;
  const code = createCode(); const host = new Peer({ role: 'host', code, relay: url, accept: async () => true }); await host.open();
  await new Promise(resolve => setTimeout(resolve, 60)); const late = new Peer({ role: 'join', code, relay: url });
  try { await assert.rejects(late.open()); } finally { late.close(); host.close(); await relay.close(); }
  const other = createRelay({ port: 0 }); const otherUrl = `ws://127.0.0.1:${await other.listen()}`; const fresh = createCode();
  const waiting = new Peer({ role: 'host', code: fresh, relay: otherUrl, approvalTimeoutMs: 30, accept: () => new Promise(() => {}) }); await waiting.open();
  const joining = new Peer({ role: 'join', code: fresh, relay: otherUrl });
  try { await assert.rejects(joining.open()); assert.match(await waiting.ended, /timeout/); }
  finally { joining.close(); waiting.close(); await other.close(); }
});

test('disconnect terminates running diagnostics and output collection is bounded', async () => {
  const s = await session(); const pidPath = join(dir, randomUUID() + '.pid');
  try {
    await s.operator.start({ operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`] }, reason: 'Verify disconnect cleanup' });
    for (let i = 0; i < 50 && !existsSync(pidPath); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(pidPath)); const pid = Number(readFileSync(pidPath, 'utf8')); s.peer.close();
    await new Promise(resolve => setTimeout(resolve, 300)); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await s.close(); }
  const task = taskSchema.parse({ id: randomUUID(), operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(12*1024*1024));setInterval(()=>{},1000)'] }, reason: 'Output limit acceptance' });
  const result = await execute(task, new AbortController().signal);
  assert.equal(result.result.truncated, true); assert.equal(result.result.status, 'error'); assert.ok(result.outputs.reduce((sum, output) => sum + output.bytes.length, 0) <= 10 * 1024 * 1024);
});

test('replayed task IDs never repeat execution', async () => {
  const s = await session(); const path = join(dir, randomUUID() + '.once');
  const task = taskSchema.parse({ id: randomUUID(), operation: 'process.run', arguments: { executable: process.execPath, args: ['-e', `require('fs').appendFileSync(${JSON.stringify(path)},'x')`] }, reason: 'Replay acceptance' });
  const result = () => new Promise<any>(resolve => { const listener = (message: any) => { if (message.type === 'task.result' && message.id === task.id) { s.peer.off('message', listener); resolve(message.result); } }; s.peer.on('message', listener); });
  try {
    const first = result(); await s.peer.send({ type: 'task.request', task }); assert.equal((await first).status, 'ok');
    const second = result(); await s.peer.send({ type: 'task.request', task }); assert.equal((await second).status, 'duplicate'); assert.equal(readFileSync(path, 'utf8'), 'x');
  } finally { await s.close(); }
});
