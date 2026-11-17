#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createCode } from './crypto.js';
import { Peer } from './peer.js';
import { ProbeEngine } from './engine.js';
import { Operator } from './operator.js';
import { Audit, safeText } from './util.js';
import { serveMcp } from './mcp.js';
import type { TaskInput } from './schema.js';
import { SessionResources } from './resources.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { upload, download, type TransferOptions } from './transfers.js';
import { forward, type Forward } from './forward.js';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { launchAgent, agentUsage } from './agent.js';

async function attachTerminal(operator: Operator, id: string): Promise<void> {
  let done = false, cursor = 0; const wasRaw = stdin.isRaw;
  const input = (bytes: Buffer) => { const escape = bytes.indexOf(0x1d); if (escape >= 0) { done = true; bytes = bytes.subarray(0, escape); } if (bytes.length) void operator.resource({ id, action: 'input', data: bytes.toString('base64') }).catch(() => { done = true; }); };
  const resize = () => { void operator.resource({ id, action: 'resize', cols: Math.max(20, Math.min(500, stdout.columns ?? 100)), rows: Math.max(5, Math.min(200, stdout.rows ?? 30)) }).catch(() => {}); };
  stdin.setRawMode(true); stdin.on('data', input); stdin.resume(); stdout.on('resize', resize); resize();
  stdout.write('\r\n[Ctrl+] detaches; Ctrl+C is sent to the remote terminal]\r\n');
  try { while (!done) { const value = await operator.resource({ id, action: 'read', cursor }) as { cursor: number; records: { data: string }[]; ended: boolean }; cursor = value.cursor; for (const record of value.records) stdout.write(Buffer.from(record.data, 'base64')); if (value.ended) break; await new Promise(resolve => setTimeout(resolve, 25)); } }
  finally { stdin.off('data', input); stdout.off('resize', resize); stdin.setRawMode(wasRaw); stdin.pause(); stdout.write('\r\n'); }
}

async function main(): Promise<void> {
  if (process.argv[2] === 'agent') { process.exitCode = await launchAgent(process.argv.slice(3)); return; }
  const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { 'session-minutes': { type: 'string', default: '60' }, 'idle-minutes': { type: 'string', default: '10' } } });
  const [command = 'help', relay = 'https://diagnose.fenginwind.com'] = positionals;
  if (positionals.length > 2) throw new Error('Usage: diagnose start|connect|terminal|mcp [relay-url]');
  const sessionMinutes = Number(values['session-minutes']), idleMinutes = Number(values['idle-minutes']);
  if (![sessionMinutes, idleMinutes].every(value => Number.isInteger(value) && value >= 0 && value <= 10080)) throw new Error('Timeouts must be 0..10080 minutes; 0 disables endpoint timeout (relay maximum 7 days)');
  if (command === 'mcp') { await serveMcp(relay); return; }
  if (!['start', 'connect', 'terminal'].includes(command)) { console.log(`diagnose start|connect|terminal|mcp [relay-url]\n${agentUsage}\nNode.js >=22.18. Pairing codes are entered interactively, never as arguments.`); return; }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Interactive terminal required. AI clients should use diagnose mcp.');
  const rl = createInterface({ input: stdin, output: stdout });
  const shutdown = new AbortController(); let peer: Peer | undefined, engine: ProbeEngine | undefined;
  const forwards = new Map<string, Forward>();
  let resources: SessionResources | undefined, promptActive = false, secretPending: Promise<void> | undefined;
  let localCommand: (value: string) => boolean = () => false;
  const stop = () => { shutdown.abort(); peer?.close('User ended session'); void resources?.revoke().catch(() => {}); rl.close(); };
  rl.on('SIGINT', stop); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  rl.once('close', () => { shutdown.abort(); peer?.close('User terminal closed'); });
  const ask = async (text: string, signal = shutdown.signal, taskApproval = false): Promise<boolean> => {
    while (true) {
      let answer: string; promptActive = true; try { answer = (await rl.question(safeText(text) + ' [y/N] ', { signal })).trim(); } finally { promptActive = false; }
      if (!localCommand(answer)) return answer.toLowerCase() === 'y';
      signal.throwIfAborted();
      if (taskApproval && engine?.permissionMode === 'auto') return true;
    }
  };
  try {
    if (command === 'start') {
      const firstAudit = new Audit(); resources = new SessionResources(join(homedir(), '.diagnose', 'resources'), firstAudit); let sessions = 0;
      while (!shutdown.signal.aborted) {
      const audit = sessions++ === 0 ? firstAudit : new Audit(); const code = createCode();
      peer = new Peer({ role: 'host', code, relay, sessionMs: sessionMinutes * 60000, accept: async ({ label, fingerprint, signal }) => {
        console.log(`\nRequested by: ${safeText(label)} (self-asserted identity)\nFingerprint: ${fingerprint}\nResults will be available to the diagnostician and their AI provider.`);
        console.log('Choose y: approve each task/batch and its transfer.\nChoose a: grant automatic execution AND transmission for this temporary session.\nAUTO: commands have your OS permissions; results go to the diagnostician and their AI without further prompts. Raw terminal, file and tunnel channels are NOT redacted. A channel grant includes continuing input/output within its scope.\nRevoke locally with "permissions ask", cancel with "cancel", or end with Ctrl+C. Already transmitted data cannot be recalled.');
        const answer = (await rl.question('Allow this temporary diagnostic session? [y / a=auto / N] ', { signal })).trim().toLowerCase();
        const allowed = answer === 'y' || answer === 'a';
        if (answer === 'a') engine!.setPermissionMode('auto');
        audit.record('session.pairing-decision', { allowed, fingerprint }); return allowed;
      } });
      engine = new ProbeEngine(peer, async request => {
        console.log(`\n[${request.stage === 'execute' ? 'EXECUTION APPROVAL' : 'TRANSFER APPROVAL'}] ${request.task.operation}\nTask: ${request.task.id}\nSHA256: ${request.digest}\n${safeText(request.preview)}\n`);
        return ask(request.stage === 'execute' ? 'Allow exactly this operation? Commands run with your OS permissions.' : `Send these results (${request.bytes ?? 0} output bytes plus metadata)?`, request.signal, true);
      }, audit, message => console.log(safeText(message)), { resources, idleMs: idleMinutes * 60000, lifetimeMs: sessionMinutes * 60000 });
      let active = false, autoRequestedAt = 0;
      peer.on('active', () => { active = true; console.log(`Session permissions: ${engine!.permissionMode}. Local commands: permissions, permissions auto, permissions ask, jobs, recover <id>, secret <id>, cancel, exit.`); });
      localCommand = value => {
        if (!active && !['jobs', 'cancel', 'exit', 'permissions ask'].includes(value) && !value.startsWith('recover ') && !value.startsWith('secret ')) return false;
        if (value === 'permissions') { console.log(`Permission mode: ${engine!.permissionMode}. AUTO means automatic execution AND transmission to the diagnostician/AI. Use permissions ask to revoke and cancel active work.`); return true; }
        if (value === 'permissions auto') { autoRequestedAt = Date.now(); console.log('AUTO grants this session automatic execution with your OS permissions AND automatic result transmission. Binary output is not redacted. Type "permissions allow-auto" within 60 seconds to grant, or "permissions ask" to decline.'); return true; }
        if (value === 'permissions allow-auto') {
          if (autoRequestedAt && Date.now() - autoRequestedAt < 60000) { engine!.setPermissionMode('auto'); autoRequestedAt = 0; }
          else console.log('No pending grant. First type "permissions auto" and read its explanation.');
          return true;
        }
        if (value === 'permissions ask') { autoRequestedAt = 0; engine!.setPermissionMode('ask'); void resources!.revoke().catch(error => console.error(safeText((error as Error).message))); console.log('Approval required. Automatic permissions revoked; any active work is cancelled.'); return true; }
        if (value === 'cancel') { engine!.cancelAll(); void resources!.revoke().catch(error => console.error(safeText((error as Error).message))); console.log('Cancellation requested for the current task/batch and retained resources.'); return true; }
        if (value === 'jobs') { console.log(safeText(JSON.stringify(resources!.listLocal(), null, 2))); return true; }
        if (value.startsWith('recover ')) { const id = value.slice(8).trim(); console.log(`Resource: ${id}\nNew recovery credential (share privately): ${resources!.renewCredential(id)}`); return true; }
        if (value.startsWith('secret ')) {
          if (promptActive || secretPending) { console.log('Finish the current approval before local hidden input.'); return true; }
          if (process.platform === 'win32') { console.log('Hidden local input is not yet validated on Windows; use native local OS authentication.'); return true; }
          const id = value.slice(7).trim();
          secretPending = (async () => {
            console.log('Local input goes directly to the approved process. Use only a trusted foreground program; its output can still be transmitted.');
            const wasRaw = stdin.isRaw; rl.pause(); stdin.setRawMode(false);
            try { const value = await new Promise<Buffer>((resolveInput, reject) => { const chunks: Buffer[] = []; const child = spawn('/bin/bash', ['-c', 'IFS= read -r -s -p "Hidden local input: " v; printf "%s" "$v"'], { stdio: ['inherit', 'pipe', 'inherit'] }); child.stdout.on('data', bytes => chunks.push(bytes)); child.on('error', reject); child.on('close', code => code === 0 ? resolveInput(Buffer.concat(chunks)) : reject(new Error('Local input cancelled'))); }); await resources!.localInput(id, Buffer.concat([value, Buffer.from('\n')])); value.fill(0); stdout.write('\nLocal input sent.\n'); }
            finally { stdin.setRawMode(wasRaw); rl.resume(); }
          })().catch(error => console.error(safeText((error as Error).message))).finally(() => { secretPending = undefined; });
          return true;
        }
        if (value === 'exit') { stop(); return true; }
        return false;
      };
      const onLocalLine = (value: string) => { try { if (!localCommand(value.trim())) console.log('Local commands: permissions, permissions auto, permissions ask, jobs, recover <id>, secret <id>, cancel, exit.'); } catch (error) { console.error(safeText((error as Error).message)); stop(); } };
      rl.on('line', onLocalLine);
      try {
        await peer.open();
        console.log(`Relay: ${relay}\nAudit: ${audit.path}\nPairing code (10 minutes, share privately):\n${code}\nCtrl+C ends the session and cancels active tasks.`);
        console.log(`Session ended: ${safeText(await peer.ended)}`);
      } catch (error) { if (!shutdown.signal.aborted) console.log(`Relay unavailable: ${safeText((error as Error).message)}. Retained work remains local; retrying in 3 seconds.`); await delay(3000, undefined, { signal: shutdown.signal }).catch(() => {}); }
      finally { rl.off('line', onLocalLine); }
      active = false; if (secretPending) await secretPending;
      if (!shutdown.signal.aborted) console.log('Probe is still running. Retained resources can be resumed after a NEW pairing and local authorization; commands are never replayed. Ctrl+C closes all resources.');
      }
    } else {
      const code = (await rl.question('Pairing code: ', { signal: shutdown.signal })).trim();
      const label = await rl.question('Your label / AI provider: ', { signal: shutdown.signal });
      peer = new Peer({ role: 'join', code, relay, label }); const operator = new Operator(peer);
      if (command === 'terminal') {
        await peer.open(); const result = await operator.run({ operation: 'process.open', arguments: { pty: true }, reason: 'Open an interactive terminal with continuing raw input/output and persistent shell context' });
        if (result.result.status !== 'ok') throw new Error(result.result.error ?? result.result.status);
        rl.removeAllListeners('SIGINT'); rl.removeAllListeners('close'); rl.close(); await attachTerminal(operator, (result.result.data as { id: string }).id); return;
      }
      await peer.open(); console.log(`Connected. Fingerprint: ${peer.fingerprint}\nEnter task JSON: batch.run, process.script, process.open (pty/stdin), file.transfer, net.forward, resource.resume.\nCommands: cancel <task>, wait <task>, resources, read <resource> [cursor], input <resource> <JSON string>, resize <resource> <cols> <rows>, signal <resource> <SIGINT>, close <resource>, forward <resource> [localPort], upload/download <JSON>, exit.\nLive resources require v0.3+ on both endpoints. diagnose terminal opens a native terminal.`);
      peer.ended.then(() => stop());
      while (!shutdown.signal.aborted) {
        const line = (await rl.question('diagnose> ', { signal: shutdown.signal })).trim();
        if (line === 'exit') break;
        try {
          if (line.startsWith('cancel ')) { await operator.cancel(line.slice(7).trim()); console.log('Cancellation requested'); }
          else if (line.startsWith('wait ')) console.log(safeText(JSON.stringify(await operator.wait(line.slice(5).trim(), 1000), null, 2)));
          else if (line === 'resources') console.log(JSON.stringify(await operator.resource({ action: 'list' }), null, 2));
          else if (line.startsWith('read ')) { const [, id, cursor] = line.split(/\s+/); const value = await operator.resource({ id, action: 'read', cursor: Number(cursor ?? 0) }) as { records?: { stream: string; data: string }[] }; console.log(safeText(JSON.stringify({ ...value, ...(value.records ? { records: value.records.map(record => ({ stream: record.stream, text: Buffer.from(record.data, 'base64').toString() })) } : {}) }, null, 2))); }
          else if (line.startsWith('input ')) { const match = /^input (\S+) (.+)$/.exec(line); if (!match) throw new Error('input <id> <JSON string>'); console.log(await operator.resource({ id: match[1], action: 'input', data: Buffer.from(JSON.parse(match[2]) as string).toString('base64') })); }
          else if (/^(resize|signal|close) /.test(line)) { const [action, id, a, b] = line.split(/\s+/); if (action === 'close' && forwards.has(id)) { await forwards.get(id)!.close(); forwards.delete(id); } else console.log(await operator.resource({ id, action: action as 'resize' | 'signal' | 'close', ...(action === 'resize' ? { cols: Number(a), rows: Number(b) } : action === 'signal' ? { signal: (a ?? 'SIGINT') as 'SIGINT' } : {}) })); }
          else if (line.startsWith('forward ')) { const [, id, port] = line.split(/\s+/); if (forwards.has(id) && !forwards.get(id)!.closed) throw new Error('Forward already open'); const listener = await forward(operator, id, Number(port ?? 0)); forwards.set(id, listener); console.log(`Forward active: ${listener.direction} ${listener.host}:${listener.port}; close ${id} releases both endpoints.`); }
          else if (/^(upload|download) /.test(line)) { const separator = line.indexOf(' '), action = line.slice(0, separator), options = JSON.parse(line.slice(separator + 1)) as TransferOptions & { localPath: string; remotePath: string; reason: string }; const settings = { ...options, signal: shutdown.signal, progress: (value: unknown) => console.log(safeText(JSON.stringify(value))) }; console.log(await (action === 'upload' ? upload(operator, options.localPath, options.remotePath, options.reason, settings) : download(operator, options.remotePath, options.localPath, options.reason, settings))); }
          else if (line) console.log(`Task: ${await operator.start(JSON.parse(line) as TaskInput)}`);
        } catch (error) { console.error(safeText((error as Error).message)); }
      }
    }
  } finally { for (const value of forwards.values()) await value.close(); stop(); await resources?.revoke(); }
}
main().catch(error => { console.error(safeText((error as Error).name === 'AbortError' ? 'Session ended' : (error as Error).message)); process.exitCode = 1; });
