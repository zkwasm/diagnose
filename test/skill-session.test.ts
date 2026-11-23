import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRelay } from '../dist/relay.js';
import { createInvitation } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Audit } from '../dist/util.js';

function helper(action: string, input: Record<string, unknown>, onProgress?: (stderr: string) => void): Promise<Record<string, any>> {
  const script = process.env.DIAGNOSE_TEST_SKILL ?? resolve('skills/connect/scripts/run.mjs');
  const child = spawn(process.execPath, [script, action], { stdio: 'pipe' });
  let out = '', err = '';
  child.stdout.setEncoding('utf8').on('data', text => { out += text; });
  child.stderr.setEncoding('utf8').on('data', text => { err += text; onProgress?.(err); });
  child.stdin.end(JSON.stringify(input));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => {
      if (status !== 0) { reject(new Error(err)); return; }
      try { resolve(JSON.parse(out)); }
      catch (error) { reject(error); }
    });
  });
}

test('native Skill pairs once, inspects performance, tracks repair retries, and closes', { timeout: 90000 }, async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'diagnose-skill-')));
  const config = join(scratch, 'config.txt');
  await writeFile(config, 'offline\n');
  const relay = createRelay({ port: 0 });
  const url = 'ws://127.0.0.1:' + await relay.listen();
  const code = createInvitation();
  let pairs = 0;
  let approve!: (value: boolean) => void;
  const approval = new Promise<boolean>(resolve => { approve = resolve; });
  let approveWrite!: () => void;
  const pendingWrite = new Promise<void>(resolve => { approveWrite = resolve; });
  let notifyTransfer!: () => void, approveTransfer!: () => void;
  const transferReady = new Promise<void>(resolve => { notifyTransfer = resolve; });
  const pendingTransfer = new Promise<void>(resolve => { approveTransfer = resolve; });
  const approvals: Array<string> = [];
  const host = new Peer({ role: 'host', code, relay: url, approvalTimeoutMs: 5000, accept: async () => { pairs++; return approval; } });
  new ProbeEngine(host, async request => {
    approvals.push(request.stage);
    if (request.task.operation === 'file.write') {
      if (request.stage === 'execute') await pendingWrite;
      else { notifyTransfer(); await pendingTransfer; }
    }
    return true;
  }, new Audit(join(scratch, 'audit')));
  let session: string | undefined;
  try {
    await host.open();
    let progress = '';
    const opened = await helper('open', { code, label: 'Skill test', relay: url }, stderr => {
      progress = stderr;
      if (stderr.includes('Waiting for it to accept the connection')) approve(true);
    });
    assert.match(progress, /Connecting to the Diagnose relay\.[\s\S]+Connected to the relay\.[\s\S]+Authenticated the on-site probe\.[\s\S]+Paired with the on-site probe\./);
    assert.ok(!progress.includes(code));
    assert.equal(opened.connected, true);
    assert.equal(opened.idleSeconds, 6 * 60 * 60);
    session = opened.session;
    assert.ok(session);
    const call = (tool: string, args: object) => helper('call', { session, tool, arguments: args });
    const run = async (operation: string, args: object) => {
      const { id } = await call('diagnose_start', { operation, arguments: args, reason: 'Test an isolated demo configuration' });
      const deadline = Date.now() + 25000;
      do {
        const outcome = await call('diagnose_wait', { id, timeoutMs: 5000 });
        if (!outcome.pending) return outcome;
      } while (Date.now() < deadline);
      assert.fail(`${operation} did not return a final result`);
    };
    const forged = session.replace(/.$/, session.endsWith('0') ? '1' : '0');
    await assert.rejects(helper('close', { session: forged }), /Invalid skill session/);
    await assert.rejects(call('diagnose_start', { operation: 'net.forward', arguments: {} }), /Unsupported operation/);
    const inspection = await run('system.inspect', {});
    assert.equal(inspection.result.data.platform, process.platform);
    assert.ok(Array.isArray(inspection.result.data.serialPorts));
    const command = process.platform === 'win32'
      ? { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', '40 + 2'] }
      : { executable: '/bin/sh', args: ['-c', 'printf "%s" "$((40 + 2))"'] };
    const executed = await run('process.run', { ...command, cwd: scratch, timeoutMs: 15000 });
    assert.equal(executed.result.status, 'ok', JSON.stringify(executed.result));
    assert.equal(executed.outputs.stdout.trim(), '42');

    const logPath = join(scratch, 'growing.log');
    const log = await open(logPath, 'wx');
    const writer = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => process.stdout.write("tick\\n"), 50)'], {
      cwd: scratch, stdio: ['ignore', log.fd, 'ignore'],
    });
    const writerEnded = new Promise(resolve => writer.once('close', resolve));
    try {
      const args = { pids: [writer.pid], diskPath: scratch, logPaths: process.platform === 'win32' ? [logPath] : [] };
      const performance = await run('system.performance', args);
      assert.equal(performance.result.status, 'ok');
      const { processes, disk, logs, processStatus } = performance.result.data;
      assert.equal(processStatus, 'sampled');
      assert.equal(processes[0]?.pid, writer.pid);
      assert.equal(processes[0].ppid, process.pid);
      assert.ok(processes[0].elapsed);
      assert.ok(disk.availableBytes > 0);
      const sample = logs.find((entry: { path: string }) => entry.path === logPath);
      assert.ok(sample, JSON.stringify(logs));
      assert.equal(sample.state, 'sampled');
      assert.ok(sample.deltaBytes > 0);
      if (process.platform !== 'win32') assert.deepEqual(sample.pids, [writer.pid]);
    } finally {
      writer.kill();
      await writerEnded;
      await log.close();
    }

    assert.equal((await run('file.read', { path: config })).outputs.file, 'offline\n');
    const expectedSha256 = createHash('sha256').update('offline\n').digest('hex');
    const repair = { requestId: randomUUID(), operation: 'file.write', arguments: { path: config, content: 'online\n', expectedSha256 }, reason: 'Repair the isolated demo configuration' };
    assert.deepEqual(await call('diagnose_start', repair), { id: repair.requestId });
    assert.deepEqual(await call('diagnose_wait', { id: repair.requestId, timeoutMs: 100 }), { id: repair.requestId, pending: true, stage: 'awaiting-execution-approval', state: 'pending' });
    assert.deepEqual(await call('diagnose_start', repair), { id: repair.requestId });
    await assert.rejects(call('diagnose_start', { ...repair, reason: 'Different task' }), /belongs to a different task/);
    approveWrite();
    await transferReady;
    assert.equal((await call('diagnose_wait', { id: repair.requestId, timeoutMs: 100 })).stage, 'awaiting-transfer-approval');
    approveTransfer();
    const completed = await call('diagnose_wait', { id: repair.requestId, timeoutMs: 5000, release: true });
    assert.equal(completed.state, 'finished');
    assert.equal(completed.result.status, 'ok');
    assert.deepEqual(await call('diagnose_start', repair), { id: repair.requestId });
    assert.equal((await call('diagnose_wait', { id: repair.requestId, timeoutMs: 0 })).outputsAvailable, false);
    assert.equal((await call('diagnose_wait', { id: randomUUID(), timeoutMs: 0 })).state, 'unknown');
    assert.equal((await run('file.read', { path: config })).outputs.file, 'online\n');
    assert.equal(await readFile(config, 'utf8'), 'online\n');
    assert.equal(pairs, 1);
    assert.deepEqual(approvals, Array.from({ length: 6 }, () => ['execute', 'send']).flat());
    const handle = session;
    assert.equal((await helper('close', { session })).disconnected, true);
    session = undefined;
    assert.equal(await host.ended, 'Diagnostician ended session');
    await assert.rejects(helper('call', { session: handle, tool: 'diagnose_wait', arguments: {} }), /session unavailable/i);
  } finally {
    approveWrite();
    approveTransfer();
    if (session) await helper('close', { session }).catch(() => {});
    host.close();
    await relay.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
