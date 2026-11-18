import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRelay } from '../dist/relay.js';
import { createInvitation } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Audit } from '../dist/util.js';

function helper(action: string, input: Record<string, unknown>): Promise<Record<string, any>> {
  const script = process.env.DIAGNOSE_TEST_SKILL ?? resolve('skills/connect/scripts/run.mjs');
  const child = spawn(process.execPath, [script, action], { stdio: 'pipe' });
  let out = '', err = '';
  child.stdout.setEncoding('utf8').on('data', text => { out += text; });
  child.stderr.setEncoding('utf8').on('data', text => { err += text; });
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

test('native Skill helper pairs once, reuses the connection for a repair and closes it', { timeout: 30000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'diagnose-skill-'));
  const config = join(scratch, 'config.txt');
  await writeFile(config, 'offline\n');
  const relay = createRelay({ port: 0 });
  const url = 'ws://127.0.0.1:' + await relay.listen();
  const code = createInvitation();
  let pairs = 0;
  const approvals: Array<string> = [];
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => { pairs++; return true; } });
  new ProbeEngine(host, async request => { approvals.push(request.stage); return true; }, new Audit(join(scratch, 'audit')));
  let session: string | undefined;
  try {
    await host.open();
    const opened = await helper('open', { code, label: 'Skill test', relay: url });
    assert.equal(opened.connected, true);
    assert.equal(opened.idleSeconds, 6 * 60 * 60);
    session = opened.session;
    assert.ok(session);
    const call = (tool: string, args: object) => helper('call', { session, tool, arguments: args });
    const run = async (operation: string, args: object) => {
      const { id } = await call('diagnose_start', { operation, arguments: args, reason: 'Test an isolated demo configuration' });
      return call('diagnose_wait', { id, timeoutMs: 5000 });
    };
    const forged = session.replace(/.$/, session.endsWith('0') ? '1' : '0');
    await assert.rejects(helper('close', { session: forged }), /Invalid skill session/);
    await assert.rejects(call('diagnose_start', { operation: 'net.forward', arguments: {} }), /Unsupported operation/);
    const inspection = await run('system.inspect', {});
    assert.equal(inspection.result.data.platform, process.platform);
    assert.ok(Array.isArray(inspection.result.data.serialPorts));
    assert.equal((await run('file.read', { path: config })).outputs.file, 'offline\n');
    const expectedSha256 = createHash('sha256').update('offline\n').digest('hex');
    assert.equal((await run('file.write', { path: config, content: 'online\n', expectedSha256 })).result.status, 'ok');
    assert.equal((await run('file.read', { path: config })).outputs.file, 'online\n');
    assert.equal(await readFile(config, 'utf8'), 'online\n');
    assert.equal(pairs, 1);
    assert.deepEqual(approvals, ['execute', 'send', 'execute', 'send', 'execute', 'send', 'execute', 'send']);
    const handle = session;
    assert.equal((await helper('close', { session })).disconnected, true);
    session = undefined;
    assert.equal(await host.ended, 'Diagnostician ended session');
    await assert.rejects(helper('call', { session: handle, tool: 'diagnose_wait', arguments: {} }), /session unavailable/i);
  } finally {
    if (session) await helper('close', { session }).catch(() => {});
    host.close();
    await relay.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
