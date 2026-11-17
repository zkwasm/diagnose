import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRelay } from '../dist/relay.js';
import { createCode } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Operator } from '../dist/operator.js';
import { Audit } from '../dist/util.js';
import { taskSchema, type ApprovalHandler, type TaskInput } from '../dist/schema.js';

const dir = mkdtempSync(join(tmpdir(), 'diagnose-batch-'));
const script = (source: string) => ({ operation: 'process.script', arguments: { interpreter: process.execPath, script: source } });
async function session(approve: ApprovalHandler = async () => true, notice: (text: string) => void = () => {}) {
  const relay = createRelay({ port: 0 }); const url = `ws://127.0.0.1:${await relay.listen()}`; const code = createCode();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  const audit = new Audit(join(dir, randomUUID() + '.jsonl')); const engine = new ProbeEngine(host, approve, audit, notice); await host.open();
  const peer = new Peer({ role: 'join', code, relay: url }); const operator = new Operator(peer); await peer.open();
  return { engine, audit, operator, peer, async close() { peer.close(); host.close(); await relay.close(); } };
}
function batch(steps: unknown[], extra = {}): TaskInput { return { operation: 'batch.run', arguments: { steps, ...extra }, reason: 'Batch acceptance' }; }
async function waitFile(path: string): Promise<void> { for (let i = 0; i < 100 && !existsSync(path); i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(existsSync(path), 'diagnostic process started'); }

test('one plan approval and one transfer approval cover ordered writes, reads and a full script', async () => {
  const stages: string[] = [], previews: string[] = []; const target = join(dir, randomUUID());
  const source = 'const n = 2 + 3;\nconsole.log("script result", n);';
  const s = await session(async request => { stages.push(request.stage); previews.push(request.preview); return true; });
  try {
    const result = await s.operator.run(batch([{ operation: 'file.write', arguments: { path: target, content: 'plan-data' } }, { operation: 'file.read', arguments: { path: target } }, script(source)]));
    assert.equal(result.result.status, 'ok'); assert.deepEqual(stages, ['execute', 'send']); assert.ok(previews[0].includes(source), 'complete multiline script shown');
    assert.equal(result.outputs['1.file'], 'plan-data'); assert.equal(result.outputs['2.stdout'], 'script result 5\n');
    const data = result.result.data as any; assert.equal(data.completedSteps, 3); assert.equal(data.steps[0].result.status, 'ok');
    const entries = readFileSync(s.audit.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(entries.filter(e => e.event === 'task.executing').length, 3); assert.ok(entries.some(e => e.event === 'task.file-changed' && e.parentId === result.id));
  } finally { await s.close(); }
});

test('batch refusal does not execute; transfer refusal returns no collected output', async () => {
  let executeAllowed = false; const target = join(dir, randomUUID()); const s = await session(async request => executeAllowed && request.stage === 'execute');
  try {
    const refused = await s.operator.run(batch([{ operation: 'file.write', arguments: { path: target, content: 'no' } }]));
    assert.equal(refused.result.status, 'denied'); assert.equal(existsSync(target), false);
    executeAllowed = true;
    const local = await s.operator.run(batch([script('console.log("LOCAL_BATCH_ONLY")'), script('console.log("LOCAL_SECOND")')]));
    assert.equal(local.result.status, 'denied'); assert.deepEqual(local.outputs, {});
  } finally { await s.close(); }
});

test('batch failure stops later steps by default; explicit continue runs independent steps', async () => {
  const s = await session(); const target = join(dir, randomUUID());
  try {
    const steps = [script('throw new Error("expected failure")'), { operation: 'file.write', arguments: { path: target, content: 'continued' } }];
    const stopped = await s.operator.run(batch(steps)); assert.equal(stopped.result.status, 'error'); assert.equal(existsSync(target), false); assert.equal((stopped.result.data as any).completedSteps, 1);
    const continued = await s.operator.run(batch(steps, { stopOnError: false })); assert.equal(continued.result.status, 'error'); assert.equal(readFileSync(target, 'utf8'), 'continued'); assert.equal((continued.result.data as any).completedSteps, 2);
  } finally { await s.close(); }
});

test('batch deadline terminates the child and leaves later steps unexecuted', async () => {
  const pidPath = join(dir, randomUUID() + '.pid'), target = join(dir, randomUUID()); const s = await session();
  try {
    const result = await s.operator.run(batch([script(`require('fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`), { operation: 'file.write', arguments: { path: target, content: 'no' } }], { timeoutMs: 350 }));
    assert.equal(result.result.error, 'Batch timeout'); assert.equal(existsSync(target), false); assert.ok(existsSync(pidPath));
    assert.throws(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0), { code: 'ESRCH' });
  } finally { await s.close(); }
});

test('auto mode approves execution AND transfer; local revocation cancels work and restores prompts', async () => {
  let prompts = 0; const pidPath = join(dir, randomUUID() + '.pid'), target = join(dir, randomUUID());
  const s = await session(async () => { prompts++; return false; });
  try {
    assert.equal(s.engine.permissionMode, 'ask'); s.engine.setPermissionMode('auto');
    const result = await s.operator.run(batch([script('console.log("automatic first")'), script('console.log("automatic second")')]));
    assert.equal(result.result.status, 'ok'); assert.equal(result.outputs['1.stdout'], 'automatic second\n'); assert.equal(prompts, 0);
    const id = await s.operator.start(batch([script(`require('fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`), { operation: 'file.write', arguments: { path: target, content: 'no' } }]));
    await waitFile(pidPath); s.engine.setPermissionMode('ask');
    const cancelled = await s.operator.wait(id, 5000); assert.equal('result' in cancelled && cancelled.result.status, 'cancelled'); assert.equal(existsSync(target), false);
    assert.throws(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0), { code: 'ESRCH' });
    const denied = await s.operator.run({ operation: 'system.inspect', arguments: {}, reason: 'After revoke' }); assert.equal(denied.result.status, 'denied'); assert.equal(prompts, 1);
    const events = readFileSync(s.audit.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(e => e.event === 'permissions.changed' && e.automaticTransfer));
    assert.ok(events.some(e => e.event === 'task.auto-approved' && e.stage === 'send'));
  } finally { await s.close(); }
});

test('revoking during automatic send approval prevents output transmission', async () => {
  let revoke = () => {}; const s = await session(async () => false, value => { if (value.startsWith('[AUTO send]')) revoke(); });
  try {
    s.engine.setPermissionMode('auto'); revoke = () => s.engine.setPermissionMode('ask');
    const result = await s.operator.run(batch([script('console.log("REVOKED_BEFORE_TRANSFER")')]));
    assert.equal(result.result.status, 'cancelled'); assert.deepEqual(result.outputs, {});
  } finally { await s.close(); }
});

test('explicit batch cancel stops the process and remaining steps', async () => {
  const pidPath = join(dir, randomUUID() + '.pid'), target = join(dir, randomUUID()); const s = await session();
  try {
    const id = await s.operator.start(batch([script(`require('fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`), { operation: 'file.write', arguments: { path: target, content: 'no' } }]));
    await waitFile(pidPath); await s.operator.cancel(id); const result = await s.operator.wait(id, 5000);
    assert.equal('result' in result && result.result.status, 'cancelled'); assert.equal(existsSync(target), false);
  } finally { await s.close(); }
});

test('all batch output shares a bounded budget and no later modifications occur after exhaustion', async () => {
  const target = join(dir, randomUUID()); let bytes = 0; const s = await session(async request => { if (request.stage === 'send') { bytes = request.bytes!; return false; } return true; });
  try {
    const result = await s.operator.run(batch([script('process.stdout.write("z".repeat(6*1024*1024))'), script('process.stdout.write("z".repeat(6*1024*1024))'), { operation: 'file.write', arguments: { path: target, content: 'no' } }]));
    assert.equal(result.result.status, 'denied'); assert.equal(bytes, 10 * 1024 * 1024); assert.equal(existsSync(target), false);
  } finally { await s.close(); }
});

test('parameter tampering, remote permission fields, nested plans and duplicate step IDs are rejected', async () => {
  const target = join(dir, randomUUID()); const s = await session(async request => { if (request.stage === 'execute' && request.task.operation === 'batch.run') request.task.arguments.steps[0].reason = 'changed'; return true; });
  try {
    const result = await s.operator.run(batch([{ operation: 'file.write', arguments: { path: target, content: 'no' } }])); assert.equal(result.result.status, 'error'); assert.equal(existsSync(target), false);
    await assert.rejects(s.operator.start(batch([script('console.log(1)')], { permissions: 'auto' })));
    await assert.rejects(s.operator.start(batch([{ operation: 'batch.run', arguments: { steps: [script('console.log(1)')] } }])));
    const id = randomUUID(); const step = { ...script('console.log(1)'), id, reason: 'duplicate' };
    assert.equal(taskSchema.safeParse({ ...batch([step, step]), id: randomUUID() }).success, false);
    assert.equal(s.engine.permissionMode, 'ask');
  } finally { await s.close(); }
});

test('a requested partial file range does not stop unrelated batch steps', async () => {
  const target = join(dir, randomUUID()); writeFileSync(target, '0123456789'); const s = await session();
  try {
    const result = await s.operator.run(batch([{ operation: 'file.read', arguments: { path: target, length: 3 } }, script('console.log("after partial read")')]));
    assert.equal(result.result.status, 'ok'); assert.equal(result.outputs['0.file'], '012'); assert.equal(result.outputs['1.stdout'], 'after partial read\n');
  } finally { await s.close(); }
});
