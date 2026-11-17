import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Cases } from '../dist/cases.js';
import { Drafts } from '../dist/knowledge-drafts.js';
import { SkillLibrary } from '../dist/skill-library.js';
import { Vault } from '../dist/vault.js';
import { newRecovery, vaultKeys, objectId, sealBundle, openBundle } from '../dist/vault-crypto.js';
import { createRelay } from '../dist/relay.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) { const root = await mkdtemp(join(tmpdir(), 'diagnose-knowledge-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
test('case records actual evidence, excludes credentials and requires later verification', async t => {
  const root = await fixture(t), cases = new Cases(join(root, 'cases'));
  const value = cases.create({ goal: 'Restore readings', host: 'site-pc', target: { name: 'Gateway', model: 'SEG-X3-C', interface: 'serial', address: '/dev/private-address' } });
  const baseline = cases.record(value.id, 'task.result', { result: { status: 'ok' }, outputs: { log: 'No readings' }, resumeToken: 'private-resume-token' }, randomUUID())!;
  assert.throws(() => cases.finish(value.id, { outcome: 'resolved', summary: 'Fixed', baseline: baseline.id, verification: baseline.id, changes: [], remaining: [] }), /distinct/);
  const after = cases.record(value.id, 'task.result', { result: { status: 'ok' }, outputs: { log: 'Readings received' } }, randomUUID())!;
  cases.finish(value.id, { outcome: 'resolved', summary: 'Readings verified', baseline: baseline.id, verification: after.id, changes: ['Reconnected sensor'], remaining: [] });
  assert.equal(cases.get(value.id).target.model, 'SEG-X3-C');
  assert.ok(!JSON.stringify(cases.get(value.id)).includes('private-resume-token'));
  const report = JSON.stringify(cases.report(value.id)); assert.ok(!report.includes('/dev/private-address')); assert.ok(!report.includes('Readings received')); assert.ok(report.includes(after.id));
  const bytes = await readFile(join(root, 'cases', value.id + '.meta')); assert.ok(!bytes.includes(Buffer.from('SEG-X3-C')));
});

test('reviewed drafts preserve references, retain base revision and detect conflicting versions', async t => {
  const root = await fixture(t), source = join(root, 'source'); await mkdir(join(source, 'references'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '# Original\n'); await writeFile(join(source, 'references/profile.md'), 'Model SEG-X3-C');
  const library = new SkillLibrary(join(root, 'skills')), base = await library.import('owon', source), cases = new Cases(join(root, 'cases'));
  const value = cases.create({ goal: 'Observe logs', target: { name: 'Gateway', interface: 'serial' }, skill: base });
  const evidence = cases.record(value.id, 'task.result', { result: { status: 'ok' }, outputs: { serial: 'fixture evidence only' } })!;
  const drafts = new Drafts(library, cases, join(root, 'drafts'));
  const input = { name: 'owon', caseId: value.id, base, evidence: [evidence.id], title: 'OWON checks', applicability: 'SEG-X3-C', prerequisites: 'Authorized serial adapter', identityChecks: 'Confirm serial number', readOnlyChecks: 'Capture logs without writes', repairConditions: 'Only after approval', recovery: 'Stop capture', verification: 'Repeat original check', failedApproaches: 'USB power alone is not diagnostic access' };
  const first = await drafts.create(input), conflicting = await drafts.create(input);
  assert.match(await drafts.review(first.id), /- # Original/);
  assert.deepEqual(await library.list(), [base]);
  const accepted = await drafts.accept(first.id); assert.notEqual(accepted, base);
  assert.equal(await readFile(join((await library.load(accepted)).baseDirectory, 'references/profile.md'), 'utf8'), 'Model SEG-X3-C');
  assert.ok(!(await library.load(accepted)).instructions.includes('fixture evidence only'));
  await assert.rejects(drafts.accept(conflicting.id), /versions changed/); assert.equal(drafts.get(conflicting.id).state, 'pending');
  drafts.reject(conflicting.id); assert.equal(drafts.get(conflicting.id).state, 'rejected');
  await assert.rejects(drafts.create({ ...input, evidence: [randomUUID()] }), /belong/);
});

test('vault AEAD binds key, object and namespace; pairing codes are not recovery keys', () => {
  const recovery = newRecovery(), id = objectId(recovery, 'reference'), bytes = Buffer.from('private skill');
  const sealed = sealBundle(recovery, id, bytes); assert.deepEqual(openBundle(recovery, id, sealed), bytes);
  assert.throws(() => openBundle(newRecovery(), id, sealed)); assert.throws(() => openBundle(recovery, '0'.repeat(64), sealed));
  const altered = Buffer.from(sealed); altered[15] ^= 1; assert.throws(() => openBundle(recovery, id, altered));
  assert.throws(() => vaultKeys('D1.' + 'a'.repeat(16) + '.' + 'b'.repeat(43)), /recovery/);
  assert.notEqual(vaultKeys(recovery).auth, recovery.slice(3));
});

test('two isolated clients sync encrypted complete versions, preserve divergence, revoke and recover offline', async t => {
  const root = await fixture(t), relay = createRelay({ port: 0, vaultPath: join(root, 'relay') }); const origin = 'http://127.0.0.1:' + await relay.listen(); t.after(() => relay.close());
  const libraryA = new SkillLibrary(join(root, 'a-skills')), libraryB = new SkillLibrary(join(root, 'b-skills'));
  const a = new Vault(libraryA, join(root, 'a-key'), origin), b = new Vault(libraryB, join(root, 'b-key'), origin), recovery = newRecovery(); await a.initialize(recovery); await b.initialize(recovery);
  const source = join(root, 'source'); await mkdir(join(source, 'scripts'), { recursive: true }); await writeFile(join(source, 'SKILL.md'), '# Private device procedure'); await writeFile(join(source, 'scripts/check.sh'), 'echo safe');
  const first = await libraryA.import('gateway', source); await a.push(first); await a.push(first);
  assert.deepEqual(await b.pull(), [first]); assert.equal(await readFile(join((await libraryB.load(first)).baseDirectory, 'scripts/check.sh'), 'utf8'), 'echo safe');
  await writeFile(join(source, 'SKILL.md'), '# Client A improvement'); const second = await libraryA.import('gateway', source);
  await writeFile(join(source, 'SKILL.md'), '# Client B improvement'); const third = await libraryB.import('gateway', source);
  await Promise.all([a.push(second), b.push(third)]); assert.deepEqual((await a.pull()).sort(), [first, second, third].sort());
  const namespace = vaultKeys(recovery).namespace;
  for (const name of await readdir(join(root, 'relay', namespace))) { const bytes = await readFile(join(root, 'relay', namespace, name)); assert.ok(!bytes.includes(Buffer.from('Private device'))); assert.ok(!bytes.includes(Buffer.from('gateway'))); }
  const unauthenticated = await fetch(origin + '/v1/library'); assert.equal(unauthenticated.status, 401);
  const backup = join(root, 'recovery-backup'); await a.backup(backup); assert.equal((await readFile(backup, 'utf8')).trim(), recovery);
  await a.revoke(); await assert.rejects(b.list(), /403/); await assert.rejects(b.push(first), /403/);
  assert.ok((await libraryB.load(first)).instructions.includes('Private device')); // cache survives revocation
});

test('vault rejects tampered ciphertext before importing and server never replaces immutable objects', async t => {
  const root = await fixture(t), relay = createRelay({ port: 0, vaultPath: join(root, 'relay') }); const origin = 'http://127.0.0.1:' + await relay.listen(); t.after(() => relay.close());
  const recovery = newRecovery(), keys = vaultKeys(recovery), id = 'a'.repeat(64), headers = { Authorization: 'Bearer ' + keys.auth, 'Content-Type': 'application/octet-stream' };
  assert.equal((await fetch(origin + '/v1/library/' + id, { method: 'PUT', headers, body: Buffer.alloc(30) })).status, 201);
  assert.equal((await fetch(origin + '/v1/library/' + id, { method: 'PUT', headers, body: Buffer.alloc(30, 1) })).status, 409);
  const library = new SkillLibrary(join(root, 'skills')), vault = new Vault(library, join(root, 'key'), origin); await vault.initialize(recovery);
  await assert.rejects(vault.pull(), /Invalid encrypted/); assert.deepEqual(await library.list(), []);
});

test('relay rejects over-quota and interrupted uploads without publishing partial objects', async t => {
  const { createServer, request } = await import('node:http');
  const { VaultServer } = await import('../dist/vault-server.js');
  const root = await fixture(t), store = new VaultServer(join(root, 'relay'), 40);
  const server = createServer((req, res) => { void store.handle(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port, recovery = newRecovery(), headers = { Authorization: 'Bearer ' + vaultKeys(recovery).auth };
  const incompleteId = 'b'.repeat(64);
  await new Promise<void>(resolve => { const req = request(origin + '/v1/library/' + incompleteId, { method: 'PUT', headers: { ...headers, 'Content-Length': '40' } }); req.on('error', () => resolve()); req.write(Buffer.alloc(30)); setTimeout(() => { req.destroy(); resolve(); }, 30); });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual((await (await fetch(origin + '/v1/library', { headers })).json() as { objects: unknown[] }).objects, []);
  assert.equal((await fetch(origin + '/v1/library/' + incompleteId, { method: 'PUT', headers, body: Buffer.alloc(30) })).status, 201);
  assert.equal((await fetch(origin + '/v1/library/' + 'c'.repeat(64), { method: 'PUT', headers, body: Buffer.alloc(30) })).status, 507);
  assert.equal((await (await fetch(origin + '/v1/library', { headers })).json() as { objects: unknown[] }).objects.length, 1);
});

test('received bundles cannot traverse directories or import a forged content revision', async t => {
  const root = await fixture(t), library = new SkillLibrary(join(root, 'skills'));
  const reference = 'library:gateway@' + 'a'.repeat(64);
  await assert.rejects(library.restore({ reference, files: [{ path: '../escape.md', data: Buffer.from('# bad').toString('base64') }] }), /path/);
  await assert.rejects(library.restore({ reference, files: [{ path: 'SKILL.md', data: Buffer.from('# valid but wrong digest').toString('base64') }] }), /integrity/);
  assert.deepEqual(await library.list(), []);
});

test('a selected case refuses a second writer and cannot be removed while active', async t => {
  const root = await fixture(t), first = new Cases(join(root, 'cases')), second = new Cases(join(root, 'cases'));
  const value = first.create({ goal: 'Inspect device', target: { name: 'Gateway', interface: 'serial' } });
  const release = first.claim(value.id); assert.throws(() => second.claim(value.id), /writer/); assert.throws(() => second.remove(value.id), /in use/); assert.throws(() => second.unlock(value.id), /still alive/);
  release(); const releaseSecond = second.claim(value.id); releaseSecond(); second.remove(value.id); assert.deepEqual(first.list(), []);
});
