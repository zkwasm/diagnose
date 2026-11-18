import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { SessionResources } from '../dist/resources.js';
import { Audit } from '../dist/util.js';
import { atomicTaskSchema, resourceRequestSchema, type Task, type WireMessage } from '../dist/schema.js';
import { download } from '../dist/transfers.js';
import { Operator } from '../dist/operator.js';
import { ProbeEngine } from '../dist/engine.js';
import type { Peer } from '../dist/peer.js';
import { Journal } from '../dist/journal.js';
import { History } from '../dist/history.js';
import { cleanupLocal } from '../dist/maintenance.js';
import { agentCommand } from '../dist/agent-command.js';
const directory = () => mkdtempSync(join(tmpdir(), 'diagnose-review-'));
const task = (operation: string, args: object) => atomicTaskSchema.parse({ id: randomUUID(), operation, arguments: args, reason: 'Review regression' });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('process leader exit and local revocation both remove ordinary descendants', { skip: process.platform === 'win32' }, async () => {
  for (const parentExits of [true, false]) {
    const root = directory(), manager = new SessionResources(join(root, 'resources'), new Audit(join(root, 'audit.jsonl'))), marker = join(root, 'pid');
    let pid: number | undefined;
    try {
      const script = `const c=require('child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));c.unref();${parentExits ? '' : 'setInterval(()=>{},1000);'}`;
      await manager.open(task('process.open', { executable: process.execPath, args: ['-e', script] }), 'owner');
      for (let i = 0; i < 100 && !existsSync(marker); i++) await wait(20);
      pid = Number(readFileSync(marker, 'utf8'));
      if (!parentExits) await manager.revoke();
      let alive = true;
      for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); if (process.platform === 'linux' && /^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'))) { alive = false; break; } } catch { alive = false; break; } await wait(20); }
      assert.equal(alive, false, 'Descendant must be stopped even after its leader exits');
    } finally { if (pid) try { process.kill(pid, 'SIGKILL'); } catch {} await manager.revoke(); }
  }
});

test('upload preserves executable permissions and refuses newly created targets', { skip: process.platform === 'win32' }, async () => {
  const root = directory(), manager = new SessionResources(join(root, 'resources'), new Audit(join(root, 'audit.jsonl'))), target = join(root, 'program');
  const bytes = Buffer.from('replacement'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const control = (id: string, action: string, extra = {}) => manager.control('owner', resourceRequestSchema.parse({ id, action, ...extra }));
  try {
    writeFileSync(target, 'original', { mode: 0o755 });
    const result = await manager.open(task('file.transfer', { direction: 'upload', path: target, overwrite: true, size: bytes.length, sha256 }), 'owner') as { id: string };
    await control(result.id, 'input', { data: bytes.toString('base64') }); await control(result.id, 'commit');
    assert.equal(statSync(target).mode & 0o777, 0o755);
    const fresh = join(root, 'new');
    const second = await manager.open(task('file.transfer', { direction: 'upload', path: fresh, size: bytes.length, sha256 }), 'owner') as { id: string };
    await control(second.id, 'input', { data: bytes.toString('base64') }); writeFileSync(fresh, 'local data');
    await assert.rejects(control(second.id, 'commit'), /changed|exists/i); assert.equal(readFileSync(fresh, 'utf8'), 'local data');
  } finally { await manager.revoke(); }
});

for (const overwrite of [false, true]) test(`download protects concurrent local edits (overwrite=${overwrite})`, async () => {
  const root = directory(), target = join(root, 'result'), bytes = Buffer.from('remote'), id = randomUUID();
  if (overwrite) writeFileSync(target, 'original');
  const operator = {
    async start() { writeFileSync(target, 'local edit while awaiting authorization'); return id; },
    async wait() { return { id, result: { status: 'ok', data: { id, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), offset: 0 } } }; }, release() {},
    async resource(request: { action: string }) { return request.action === 'read' ? { data: bytes.toString('base64'), nextOffset: bytes.length } : {}; },
  } as unknown as Operator;
  await assert.rejects(download(operator, 'remote', target, 'Regression', { overwrite }), /exist|changed/i);
  assert.equal(readFileSync(target, 'utf8'), 'local edit while awaiting authorization');
});

class FixturePeer extends EventEmitter {
  readonly active = Promise.resolve();
  response?: (value: WireMessage) => void;
  async send(value: WireMessage) { this.response?.(value); }
  close(reason: string) { this.emit('closed', reason); }
  request(task: Task, sequence: number): Promise<WireMessage> { return new Promise(resolve => { this.response = value => { if (value.type === 'task.result') resolve(value); }; this.emit('message', { type: 'task.request', task, sequence }); }); }
}
test('probe resets its six-hour idle timeout on activity without a fixed total limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const peer = new FixturePeer(), reasons: string[] = [];
  peer.on('closed', reason => reasons.push(reason));
  new ProbeEngine(peer as unknown as Peer, async () => false, new Audit(join(directory(), 'audit.jsonl')));
  await peer.active;
  for (let round = 0; round < 3; round++) {
    t.mock.timers.tick(5 * 60 * 60_000);
    assert.deepEqual(reasons, []);
    peer.emit('activity');
  }
  t.mock.timers.tick(6 * 60 * 60_000 - 1);
  assert.deepEqual(reasons, []);
  t.mock.timers.tick(1);
  assert.deepEqual(reasons, ['Idle timeout']);
});
test('more than 1000 sequenced tasks work and replayed sequences are rejected', { timeout: 60000 }, async () => {
  const root = directory(), peer = new FixturePeer(); let approvals = 0;
  new ProbeEngine(peer as unknown as Peer, async () => { approvals++; return false; }, new Audit(join(root, 'audit.jsonl')), () => {}, { idleMs: 0, lifetimeMs: 0 });
  try {
    for (let sequence = 1; sequence <= 1005; sequence++) {
      const result = await peer.request(task('system.inspect', {}), sequence);
      assert.equal(result.type === 'task.result' && result.result.status, 'denied');
    }
    assert.equal(approvals, 1005);
    const repeated = await peer.request(task('system.inspect', {}), 1005);
    assert.equal(repeated.type === 'task.result' && repeated.result.status, 'duplicate'); assert.equal(approvals, 1005);
  } finally { peer.close('Done'); }
});
test('operator bounds completed result storage without limiting lifetime task count', async () => {
  const peer = new FixturePeer(), operator = new Operator(peer as unknown as Peer);
  peer.send = async value => { if (value.type === 'task.request') peer.emit('message', { type: 'task.result', id: value.task.id, result: { status: 'ok' } }); };
  let first = '';
  for (let i = 0; i < 1005; i++) { const id = await operator.start({ operation: 'system.inspect', arguments: {}, reason: 'Long session' }); first ||= id; assert.ok(!('pending' in await operator.wait(id))); }
  await assert.rejects(operator.wait(first), /expired/); peer.close('Done');
});
test('local history retains exact task and collected results even when transfer is refused, encrypted on disk', async () => {
  const root = directory(), peer = new FixturePeer(), audit = new Audit(join(root, 'audit.jsonl'));
  new ProbeEngine(peer as unknown as Peer, async request => request.stage === 'execute', audit, () => {}, { idleMs: 0, lifetimeMs: 0 });
  const request = task('process.script', { interpreter: process.execPath, script: 'console.log("PRIVATE_HISTORY_EVIDENCE")' });
  try {
    await peer.request(request, 1); await wait(10);
    const value = audit.history.show(request.id) as { request: Task; outputs: Record<string, { data: string }>; events: { event: string }[] };
    assert.deepEqual(value.request, request); assert.match(value.outputs.stdout.data, /PRIVATE_HISTORY_EVIDENCE/);
    assert.ok(value.events.some(event => event.event === 'task.send-denied'));
    for (const name of readdirSync(join(root, 'history'))) assert.equal(readFileSync(join(root, 'history', name)).includes(Buffer.from('PRIVATE_HISTORY_EVIDENCE')), false);
    assert.equal(readFileSync(audit.path, 'utf8').includes('PRIVATE_HISTORY_EVIDENCE'), false);
    assert.equal(new History(join(root, 'history')).list().length, 1);
    cleanupLocal(0, root); assert.equal(new History(join(root, 'history')).list().length, 0);
  } finally { peer.close('Done'); }
});
test('journal budgets prune inactive records, protect live jobs, and reject unbounded output', () => {
  const root = directory(), limits = { maxBytes: 5000, maxEntries: 2, maxAgeMs: 86400000 }, journal = new Journal(root, limits);
  const meta = (state: string) => ({ id: randomUUID(), kind: 'process' as const, state, createdAt: new Date().toISOString(), updatedAt: '', ownerPid: process.pid, tokenHash: '', retainOnDisconnect: false });
  const active = meta('running'), old = meta('completed'); journal.save(active); journal.save(old); journal.append(old.id, 'stdout', Buffer.alloc(1500));
  const next = meta('completed'); journal.save(next); assert.equal(journal.exists(old.id), false); assert.equal(journal.exists(active.id), true);
  assert.throws(() => journal.append(active.id, 'stdout', Buffer.alloc(6000)), /quota/);
  journal.cleanup({ ...limits, maxAgeMs: 0 }); assert.equal(journal.exists(active.id), true); assert.equal(journal.exists(next.id), false);
});
test('Windows npm command resolution preserves literal arguments without a shell', async () => {
  const root = directory(), entry = join(root, 'node_modules', 'example', 'bin.js'); mkdirSync(join(root, 'node_modules', 'example'), { recursive: true });
  writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  writeFileSync(join(root, 'codex.cmd'), '@ECHO off\n"%_prog%" "%dp0%\\node_modules\\example\\bin.js" %*\n');
  const args = ['space value', '"quoted"', '%PATH%', '!VAR!', '$(no)', '& echo NO', '{"path":"C:\\Folder name"}'];
  const resolved = await agentCommand('codex', args, { PATH: root }, 'win32');
  const captured = await new Promise<string>((resolve, reject) => { const child = spawn(resolved.command, resolved.args, { shell: false }); let out = ''; child.stdout.on('data', b => out += b); child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`Exit ${code}`))); });
  assert.deepEqual(JSON.parse(captured), args);
  writeFileSync(join(root, 'claude.cmd'), '@echo off\necho unsupported');
  await assert.rejects(agentCommand('claude', [], { Path: root }, 'win32'), /Unsupported/);
});
