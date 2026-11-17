import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRelay } from '../dist/relay.js';
import { Peer } from '../dist/peer.js';
import { Operator } from '../dist/operator.js';

test('actual host CLI displays and enforces pairing, execution and transfer prompts', { skip: process.platform !== 'darwin', timeout: 15000 }, async () => {
  const relay = createRelay({ port: 0 }); const url = `ws://127.0.0.1:${await relay.listen()}`;
  // macOS script accepts a POSIX pipe, but not Node's socketpair-backed stdin.
  const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'diagnose-cli-test', process.execPath, resolve('dist/cli.js'), 'start', url], { detached: true, env: { ...process.env, HOME: mkdtempSync(tmpdir() + '/diagnose-cli-') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '', pairing = false, executing = false, sending = false;
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  let codeResolve!: (value: string) => void;
  const code = new Promise<string>(resolve => { codeResolve = resolve; });
  child.stdout.on('data', bytes => {
    text += bytes.toString(); const match = /\b[a-z]{3}-[a-z]{3}-[a-z]{3}\b/.exec(text); if (match) codeResolve(match[0]);
    if (!pairing && text.includes('Allow this temporary diagnostic session?')) { pairing = true; child.stdin.write('y\n'); }
    if (!executing && text.includes('Allow exactly this operation?')) { executing = true; child.stdin.write('y\n'); }
    if (!sending && text.includes('Send these results (')) { sending = true; child.stdin.write('y\n'); }
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  let peer: Peer | undefined;
  try {
    const pairCode = await Promise.race([code, new Promise<never>((_, reject) => child.once('exit', () => reject(new Error('CLI exited before registration: ' + stderr))))]);
    peer = new Peer({ role: 'join', code: pairCode, relay: url }); const operator = new Operator(peer); await peer.open();
    const result = await operator.run({ operation: 'system.inspect', arguments: {}, reason: 'Verify terminal approvals' });
    assert.equal(result.result.status, 'ok'); assert.ok(pairing && executing && sending); assert.ok(text.includes('TRANSFER APPROVAL'));
  } finally { clearTimeout(timer); peer?.close(); child.stdin.end('\x03'); if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } await relay.close(); }
});

test('host CLI auto selection skips task prompts, can revoke, and requires local confirmation to enable again', { skip: process.platform !== 'darwin', timeout: 15000 }, async () => {
  const relay = createRelay({ port: 0 }); const url = `ws://127.0.0.1:${await relay.listen()}`;
  const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'diagnose-cli-auto-test', process.execPath, resolve('dist/cli.js'), 'start', url], { detached: true, env: { ...process.env, HOME: mkdtempSync(tmpdir() + '/diagnose-cli-auto-') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', paired = false, executionPrompts = 0, transferPrompts = 0; let resolveCode!: (value: string) => void;
  const code = new Promise<string>(resolve => { resolveCode = resolve; });
  child.stderr.resume();
  child.stdout.on('data', bytes => {
    output += bytes.toString(); const match = /\b[a-z]{3}-[a-z]{3}-[a-z]{3}\b/.exec(output); if (match) resolveCode(match[0]);
    if (!paired && output.includes('Allow this temporary diagnostic session?')) { paired = true; child.stdin.write('a\n'); }
    const executionCount = output.split('Allow exactly this operation?').length - 1;
    if (executionCount > executionPrompts) { executionPrompts = executionCount; child.stdin.write('n\n'); }
    transferPrompts = output.split('Send these results (').length - 1;
  });
  const waitFor = async (predicate: () => boolean) => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(predicate()); };
  let peer: Peer | undefined;
  try {
    peer = new Peer({ role: 'join', code: await code, relay: url }); const operator = new Operator(peer); await peer.open();
    const plan = { operation: 'batch.run' as const, arguments: { steps: [{ operation: 'process.script', arguments: { interpreter: process.execPath, script: 'console.log("CLI auto")' } }, { operation: 'system.inspect', arguments: {} }] }, reason: 'Verify CLI auto plan' };
    const result = await operator.run(plan); assert.equal(result.result.status, 'ok'); assert.equal(result.outputs['0.stdout'], 'CLI auto\n'); assert.equal(executionPrompts, 0); assert.equal(transferPrompts, 0); assert.ok(output.includes('without further prompts'));
    child.stdin.write('permissions ask\n'); await waitFor(() => output.includes('Automatic permissions revoked'));
    const denied = await operator.run({ operation: 'system.inspect', arguments: {}, reason: 'After revoke' }); assert.equal(denied.result.status, 'denied'); assert.equal(executionPrompts, 1);
    child.stdin.write('permissions auto\n'); await waitFor(() => output.includes('within 60 seconds to grant'));
    child.stdin.write('permissions allow-auto\n'); await waitFor(() => output.split('Permission mode: auto').length >= 3);
    const again = await operator.run(plan); assert.equal(again.result.status, 'ok'); assert.equal(executionPrompts, 1); assert.equal(transferPrompts, 0);
  } finally { peer?.close(); child.stdin.end('\x03'); if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } await relay.close(); }
});

test('terminal CLI attaches a native PTY and executes interactive input', { skip: process.platform !== 'darwin', timeout: 15000 }, async () => {
  const { ProbeEngine } = await import('../dist/engine.js'); const { Audit } = await import('../dist/util.js'); const { createCode } = await import('../dist/crypto.js');
  const directory = mkdtempSync(join(tmpdir(), 'diagnose-terminal-')), relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true }); const engine = new ProbeEngine(host, async () => true, new Audit(join(directory, 'audit')), () => {}); await host.open();
  const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'terminal-test', process.execPath, 'dist/cli.js', 'terminal', url], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', stage = 0; child.stderr.resume();
  child.stdout.on('data', bytes => { output += bytes.toString(); if (stage === 0 && output.includes('Pairing code:')) { stage++; child.stdin.write(code + '\n'); } if (stage === 1 && output.includes('Your label')) { stage++; child.stdin.write('terminal integration\n'); } if (stage === 2 && output.includes('[Ctrl+] detaches')) { stage++; child.stdin.write('printf "NATIVE_%s\\n" "TERMINAL_OK"; test -t 0 && printf "TTY_%s\\n" "CONFIRMED"; exit\n'); } if (stage === 3 && output.includes('NATIVE_TERMINAL_OK') && output.includes('TTY_CONFIRMED')) { stage++; child.stdin.end(); } });
  const timer = setTimeout(() => { if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 10000);
  try { const exit = await new Promise<number | null>(resolve => child.once('exit', resolve)); assert.equal(exit, 0, output); assert.match(output, /NATIVE_TERMINAL_OK/); assert.match(output, /TTY_CONFIRMED/); }
  finally { clearTimeout(timer); engine.cancelAll(); host.close(); if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} await relay.close(); }
});

test('host CLI re-pairs after disconnect and resumes retained process without rerunning it', { skip: process.platform !== 'darwin', timeout: 15000 }, async () => {
  const childHome = mkdtempSync(join(tmpdir(), 'diagnose-repair-')), relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`;
  const child = spawn('/bin/sh', ['-c', 'cat | /usr/bin/script -q /dev/null "$@"', 'repair-test', process.execPath, 'dist/cli.js', 'start', url], { detached: true, env: { ...process.env, HOME: childHome }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', approvals = 0; child.stderr.resume(); child.stdout.on('data', bytes => { output += bytes.toString(); const count = output.split('Allow this temporary diagnostic session?').length - 1; if (count > approvals) { approvals = count; child.stdin.write('a\n'); } });
  const codes = () => [...new Set(output.match(/\b[a-z]{3}-[a-z]{3}-[a-z]{3}\b/g) ?? [])];
  const until = async (predicate: () => boolean) => { for (let n = 0; n < 200 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(predicate(), output); };
  let peer: Peer | undefined;
  try {
    await until(() => codes().length === 1); peer = new Peer({ role: 'join', code: codes()[0], relay: url }); let operator = new Operator(peer); await peer.open();
    const result = await operator.run({ operation: 'process.open', arguments: { executable: process.execPath, args: ['-e', 'console.log("REPAIR_READY");process.stdin.on("data",()=>{console.log("REPAIR_INPUT");process.exit(0)})'], retainOnDisconnect: true }, reason: 'Verify retained terminal after actual CLI reconnect' }); assert.equal(result.result.status, 'ok'); const job = result.result.data as { id: string; pid: number; resumeToken: string };
    peer.close(); await until(() => codes().length >= 2); peer = new Peer({ role: 'join', code: codes()[1], relay: url }); operator = new Operator(peer); await peer.open();
    const resumed = await operator.run({ operation: 'resource.resume', arguments: { id: job.id, resumeToken: job.resumeToken }, reason: 'Recover original process' }); assert.equal(resumed.result.status, 'ok'); assert.equal((resumed.result.data as { pid: number }).pid, job.pid); assert.equal(approvals, 2);
    await operator.resource({ id: job.id, action: 'input', data: Buffer.from('continue\n').toString('base64') });
    let text = ''; for (let n = 0; n < 100 && !text.includes('REPAIR_INPUT'); n++) { const value = await operator.resource({ id: job.id, action: 'read' }) as { records: { data: string }[] }; text = value.records.map(record => Buffer.from(record.data, 'base64').toString()).join(''); await new Promise(resolve => setTimeout(resolve, 20)); } assert.match(text, /REPAIR_INPUT/);
  } finally { peer?.close(); child.stdin.end('\x03'); if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} await relay.close(); }
});
