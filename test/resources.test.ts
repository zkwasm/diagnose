import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { createRelay } from '../dist/relay.js';
import { createCode } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Operator } from '../dist/operator.js';
import { Audit } from '../dist/util.js';
import { SessionResources } from '../dist/resources.js';
import { upload, download } from '../dist/transfers.js';
import { forward } from '../dist/forward.js';

async function pair(resources?: SessionResources, approve = async (_: any) => true) {
  const directory = mkdtempSync(join(tmpdir(), 'diagnose-ssh-')); const relay = createRelay({ port: 0 }); const url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode();
  const audit = new Audit(join(directory, 'audit.jsonl')); resources ??= new SessionResources(join(directory, 'resources'), audit);
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true }); const engine = new ProbeEngine(host, approve, audit, () => {}, { resources }); await host.open();
  const peer = new Peer({ role: 'join', code, relay: url }); const operator = new Operator(peer); await peer.open();
  return { directory, host, peer, operator, resources, engine, async close(revoke = true) { peer.close(); host.close(); if (revoke) await resources!.revoke(); await relay.close(); } };
}
async function start(s: Awaited<ReturnType<typeof pair>>, operation: string, args: object) { const result = await s.operator.run({ operation: operation as any, arguments: args, reason: 'SSH capability acceptance' }); assert.equal(result.result.status, 'ok', JSON.stringify(result)); s.operator.release(result.id); return result.result.data as any; }
async function readUntil(s: Awaited<ReturnType<typeof pair>>, id: string, predicate: (text: string) => boolean) { let cursor = 0, text = ''; for (let i = 0; i < 100; i++) { const value = await s.operator.resource({ id, action: 'read', cursor }) as any; cursor = value.cursor; for (const record of value.records) text += Buffer.from(record.data, 'base64').toString(); if (predicate(text)) return text; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Expected output not observed: ' + text); }

test('real-time output arrives before exit; stdin, EOF, signals and concurrent jobs work', async () => {
  const s = await pair();
  try {
    const job = await start(s, 'process.open', { executable: process.execPath, args: ['-e', 'console.log("READY_BEFORE_EXIT");process.stdin.on("data",x=>console.log("INPUT="+x.toString()));process.stdin.on("end",()=>process.exit(0));'], timeoutMs: 10000 });
    await readUntil(s, job.id, text => text.includes('READY_BEFORE_EXIT'));
    assert.equal((await s.operator.resource({ id: job.id, action: 'status' }) as any).state, 'running');
    await s.operator.resource({ id: job.id, action: 'input', data: Buffer.from('hello\n').toString('base64') }); await readUntil(s, job.id, text => text.includes('INPUT=hello'));
    const other = await start(s, 'process.open', { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] });
    await s.operator.resource({ id: other.id, action: 'signal', signal: 'SIGKILL' }); await s.operator.resource({ id: job.id, action: 'input', data: '', eof: true });
  } finally { await s.close(); }
});

test('PTY is real, preserves shell cwd/environment and handles resize', { skip: process.platform === 'win32' }, async () => {
  const s = await pair();
  try {
    const job = await start(s, 'process.open', { executable: '/bin/sh', pty: true, cwd: s.directory });
    await s.operator.resource({ id: job.id, action: 'input', data: Buffer.from('cd /tmp; export DIAG_VALUE=retained; printf "STATE=%s\\n" "$DIAG_VALUE"; pwd; test -t 0 && echo REAL_PTY\n').toString('base64') });
    const output = await readUntil(s, job.id, text => text.includes('REAL_PTY') && text.includes('STATE=retained'));
    assert.ok(output.includes('/tmp')); await s.operator.resource({ id: job.id, action: 'resize', cols: 120, rows: 42 });
    const status = await s.operator.resource({ id: job.id, action: 'status' }) as any; assert.equal(status.cols, 120); assert.equal(status.rows, 42);
    await s.operator.resource({ id: job.id, action: 'input', data: Buffer.from('exit\n').toString('base64') });
  } finally { await s.close(); }
});

test('retained job survives network disconnect; recovery never repeats execution and stored output is encrypted', async () => {
  const s = await pair(); const oncePath = join(s.directory, 'once');
  const job = await start(s, 'process.open', { executable: process.execPath, args: ['-e', `require('fs').appendFileSync(${JSON.stringify(oncePath)},'x');console.log("PRIVATE_JOURNAL_MARKER");setTimeout(()=>console.log("AFTER_DISCONNECT"),300);setTimeout(()=>process.exit(0),1000)`], retainOnDisconnect: true });
  await readUntil(s, job.id, text => text.includes('PRIVATE_JOURNAL_MARKER')); await s.close(false);
  const next = await pair(s.resources);
  try {
    await assert.rejects(next.operator.resource({ id: job.id, action: 'status' }), /not attached/);
    const resumed = await start(next, 'resource.resume', { id: job.id, resumeToken: job.resumeToken }); assert.equal(resumed.id, job.id);
    await readUntil(next, job.id, text => text.includes('AFTER_DISCONNECT')); assert.equal(readFileSync(oncePath, 'utf8'), 'x');
    const all = Buffer.concat(readdirSync(s.resources.journal.root).filter(name => name.endsWith('.log') || name.endsWith('.meta')).map(name => readFileSync(join(s.resources.journal.root, name)))); assert.equal(all.includes(Buffer.from('PRIVATE_JOURNAL_MARKER')), false);
  } finally { await next.close(); }
});

test('binary upload/download is byte exact, supports interrupted upload resume and protects existing targets', async () => {
  const s = await pair(); const source = join(s.directory, 'source'), remote = join(s.directory, 'remote'), local = join(s.directory, 'download');
  const bytes = Buffer.concat([Buffer.from('password=DO_NOT_REDACT_FILE\n'), randomBytes(1100 * 1024)]); writeFileSync(source, bytes);
  try {
    const uploaded = await upload(s.operator, source, remote, 'Transfer exact diagnostic artifact'); assert.equal(uploaded.state, 'completed'); assert.deepEqual(readFileSync(remote), bytes);
    const downloaded = await download(s.operator, remote, local, 'Retrieve exact artifact'); assert.equal(downloaded.state, 'completed'); assert.deepEqual(readFileSync(local), bytes);
    await assert.rejects(upload(s.operator, source, remote, 'Reject accidental overwrite'), /exists/);
    const { createHash } = await import('node:crypto'); const target = join(s.directory, 'resumed');
    const transfer = await start(s, 'file.transfer', { direction: 'upload', path: target, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    await s.operator.resource({ id: transfer.id, action: 'input', data: bytes.subarray(0, 100).toString('base64') });
    const resumed = await upload(s.operator, source, target, 'Resume a partial upload', { resumeId: transfer.id, resumeToken: transfer.resumeToken }); assert.equal(resumed.state, 'completed'); assert.deepEqual(readFileSync(target), bytes);
  } finally { await s.close(); }
});

async function echoServer() { const server = net.createServer({ allowHalfOpen: true }, socket => { socket.on('error', () => {}); socket.on('data', data => socket.write(data)); socket.on('end', () => socket.end()); }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return { server, port: (server.address() as net.AddressInfo).port }; }
async function exchange(port: number, bytes: Buffer): Promise<Buffer> { return new Promise((resolve, reject) => { const socket = net.createConnection(port, '127.0.0.1'); const chunks: Buffer[] = []; let count = 0; const timer = setTimeout(() => { socket.destroy(); reject(new Error('Forwarding timeout')); }, 10000); socket.on('error', reject); socket.on('connect', () => socket.write(bytes)); socket.on('data', chunk => { chunks.push(chunk); count += chunk.length; if (count >= bytes.length) { clearTimeout(timer); socket.destroy(); resolve(Buffer.concat(chunks)); } }); }); }
test('local and reverse TCP forwarding work over encrypted relay and close cleanly', async () => {
  const s = await pair(), echo = await echoServer(); const bytes = randomBytes(60000);
  try {
    for (const direction of ['local', 'remote']) { const scope = await start(s, 'net.forward', { direction, host: '127.0.0.1', port: echo.port }); const tunnel = await forward(s.operator, scope.id); assert.deepEqual(await exchange(tunnel.port, bytes), bytes); await tunnel.close(); }
  } finally { await s.close(); await new Promise<void>(resolve => echo.server.close(() => resolve())); }
});

test('continuous output requires transfer authorization before process creation, and revocation kills resources', async () => {
  const stages: string[] = []; const denied = await pair(undefined, async request => { stages.push(request.stage); return request.stage === 'execute'; });
  try { const result = await denied.operator.run({ operation: 'process.open', arguments: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, reason: 'Refuse streaming' }); assert.equal(result.result.status, 'denied'); assert.deepEqual(stages, ['execute', 'send']); assert.equal(denied.resources.listLocal().length, 0); } finally { await denied.close(); }
  const s = await pair();
  try { s.engine.setPermissionMode('auto'); const job = await start(s, 'process.open', { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], retainOnDisconnect: true }); s.engine.setPermissionMode('ask'); await assert.rejects(s.operator.resource({ id: job.id, action: 'input', data: 'eA==' }), /not attached/); } finally { await s.close(); }
});

test('SOCKS5 forwards an authorized target and rejects targets outside its scope', async () => {
  const s = await pair(), echo = await echoServer();
  try {
    const scope = await start(s, 'net.forward', { direction: 'socks', allowedHosts: ['127.0.0.1'] }); const tunnel = await forward(s.operator, scope.id);
    const socket = net.createConnection(tunnel.port, '127.0.0.1'); const received: Buffer[] = []; let buffer = Buffer.alloc(0);
    socket.on('data', bytes => { buffer = Buffer.concat([buffer, bytes]); received.push(bytes); }); socket.on('error', () => {});
    const waitBytes = async (count: number) => { for (let i = 0; i < 100 && buffer.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(buffer.length >= count); const value = buffer.subarray(0, count); buffer = buffer.subarray(count); return value; };
    socket.write(Buffer.from([5, 1, 0])); assert.deepEqual(await waitBytes(2), Buffer.from([5, 0]));
    const request = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 0]); request.writeUInt16BE(echo.port, 8); socket.write(request); assert.equal((await waitBytes(10))[1], 0);
    socket.write(Buffer.from('SOCKS_DIAGNOSTIC')); assert.equal((await waitBytes(16)).toString(), 'SOCKS_DIAGNOSTIC'); socket.destroy();
    await assert.rejects(s.operator.resource({ id: scope.id, action: 'connect', host: 'not-authorized.example', port: 80 }), /outside/); await tunnel.close();
  } finally { await s.close(); await new Promise<void>(resolve => echo.server.close(() => resolve())); }
});

test('saved output survives a new manager and host process recovery does not repeat commands', async () => {
  const s = await pair(); const job = await start(s, 'process.open', { executable: process.execPath, args: ['-e', 'console.log("PERSISTED_READ_ONLY_RESULT")'], retainOnDisconnect: true });
  await readUntil(s, job.id, text => text.includes('PERSISTED_READ_ONLY_RESULT')); await new Promise(resolve => setTimeout(resolve, 100)); await s.close(false);
  const audit = new Audit(join(s.directory, 'restart-audit.jsonl')), manager = new SessionResources(s.resources.journal.root, audit), next = await pair(manager);
  try { await start(next, 'resource.resume', { id: job.id, resumeToken: job.resumeToken }); assert.ok((await readUntil(next, job.id, text => text.includes('PERSISTED_READ_ONLY_RESULT'))).includes('PERSISTED_READ_ONLY_RESULT')); }
  finally { await next.close(); }
});

test('uploads reject corrupt content and concurrent destination changes without replacing the destination', async () => {
  const s = await pair(); const destination = join(s.directory, 'protected'); writeFileSync(destination, 'original');
  try {
    const { createHash } = await import('node:crypto'), sha = createHash('sha256').update('expected').digest('hex');
    const corrupt = await start(s, 'file.transfer', { direction: 'upload', path: destination, size: 8, sha256: sha, overwrite: true });
    await s.operator.resource({ id: corrupt.id, action: 'input', data: Buffer.from('corrupt!').toString('base64') }); await assert.rejects(s.operator.resource({ id: corrupt.id, action: 'commit' }), /mismatch/); assert.equal(readFileSync(destination, 'utf8'), 'original');
    const changed = await start(s, 'file.transfer', { direction: 'upload', path: destination, size: 8, sha256: sha, overwrite: true });
    await s.operator.resource({ id: changed.id, action: 'input', data: Buffer.from('expected').toString('base64') }); writeFileSync(destination, 'local change'); await assert.rejects(s.operator.resource({ id: changed.id, action: 'commit' }), /changed/); assert.equal(readFileSync(destination, 'utf8'), 'local change');
  } finally { await s.close(); }
});

test('download resumes its partial file, and completed processes reject signals and input', async () => {
  const s = await pair(), source = join(s.directory, 'binary'), target = join(s.directory, 'retrieved'); const bytes = randomBytes(180000); writeFileSync(source, bytes);
  try {
    const abort = new AbortController(); await assert.rejects(download(s.operator, source, target, 'Interrupted collection', { signal: abort.signal, progress: p => { if (p.bytes >= 65536) abort.abort(); } }));
    assert.equal((await download(s.operator, source, target, 'Resume collection')).state, 'completed'); assert.deepEqual(readFileSync(target), bytes);
    const job = await start(s, 'process.open', { executable: process.execPath, args: ['-e', 'console.log("FINISHED")'] }); await readUntil(s, job.id, text => text.includes('FINISHED')); await new Promise(resolve => setTimeout(resolve, 100));
    await assert.rejects(s.operator.resource({ id: job.id, action: 'signal', signal: 'SIGKILL' }), /finished/); await assert.rejects(s.operator.resource({ id: job.id, action: 'input', data: 'eA==' }), /finished/);
  } finally { await s.close(); }
});

test('filesystem operations expose listing/stat and protect rename destinations by default', async () => {
  const s = await pair(), directory = join(s.directory, 'workspace'), source = join(directory, 'source'), target = join(directory, 'target');
  try {
    await start(s, 'file.mkdir', { path: directory }); writeFileSync(source, 'source'); writeFileSync(target, 'target');
    const listing = await start(s, 'file.list', { path: directory }); assert.equal(listing.entries.length, 2); assert.equal((await start(s, 'file.stat', { path: source })).type, 'file');
    const result = await s.operator.run({ operation: 'file.rename', arguments: { path: source, destination: target }, reason: 'Check overwrite refusal' }); assert.equal(result.result.status, 'error'); assert.equal(readFileSync(target, 'utf8'), 'target');
    await start(s, 'file.rename', { path: source, destination: target, overwrite: true }); assert.equal(readFileSync(target, 'utf8'), 'source'); await start(s, 'file.chmod', { path: target, mode: 0o600 }); await start(s, 'file.remove', { path: directory, recursive: true });
  } finally { await s.close(); }
});
