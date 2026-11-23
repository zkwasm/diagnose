import { spawn, type ChildProcess } from 'node:child_process';
import { constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { open, rename, unlink, lstat, opendir, mkdir, rm, chmod, readlink } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { inspectSystem } from './discover.js';
import { inspectPerformance } from './performance.js';
import { SerialPort } from 'serialport';
import { MAX_OUTPUT, type AtomicTask, type Task, type Result } from './schema.js';
import { redact, sha256 } from './util.js';

export type Execution = { result: Result; outputs: { stream: string; bytes: Buffer; encoding: 'utf8' | 'base64'; truncated?: boolean }[] };
export type SerialState = 'serial-ready' | 'awaiting-serial-device';
export function prepareWrite(task: Task): { sha: string | null; preview: string; parent: string } | undefined {
  if (task.operation !== 'file.write') return;
  const path = resolve(task.arguments.path);
  let before: Buffer | undefined;
  try { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Target must be a regular file'); if (stat.size > 1024 * 1024) throw new Error('Existing file exceeds 1 MiB preview limit'); before = readFileSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { sha: before ? sha256(before) : null, parent: realpathSync(dirname(path)), preview: `Before:\n${redact(before?.toString('utf8') ?? '(new file)')}\nAfter:\n${redact(task.arguments.content)}` };
}
function output(stream: string, bytes: Buffer): Execution['outputs'][number] {
  if (!isUtf8(bytes)) return { stream, bytes, encoding: 'base64' };
  const clean = Buffer.from(redact(bytes.toString('utf8')));
  return { stream, bytes: clean.subarray(0, MAX_OUTPUT), encoding: 'utf8', truncated: clean.length > MAX_OUTPUT };
}
export async function execute(task: AtomicTask, signal: AbortSignal, write?: ReturnType<typeof prepareWrite>, serialState?: (state: SerialState) => void): Promise<Execution> {
  signal.throwIfAborted();
  switch (task.operation) {
    case 'system.inspect': return { result: { status: 'ok', data: await inspectSystem() }, outputs: [] };
    case 'system.performance': return { result: { status: 'ok', data: await inspectPerformance(task.arguments, signal) }, outputs: [] };
    case 'file.stat': {
      const stat = await lstat(task.arguments.path);
      return { result: { status: 'ok', data: { size: stat.size, mode: stat.mode & 0o777, modifiedAt: stat.mtime.toISOString(), type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other', ...(stat.isSymbolicLink() ? { target: await readlink(task.arguments.path) } : {}) } }, outputs: [] };
    }
    case 'file.list': {
      const directory = await opendir(task.arguments.path); const entries: { name: string; type: string }[] = []; let index = 0, more = false;
      for await (const entry of directory) { signal.throwIfAborted(); if (index++ < task.arguments.offset) continue; if (entries.length >= task.arguments.limit) { more = true; break; } entries.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : 'other' }); }
      return { result: { status: 'ok', data: { entries, nextOffset: task.arguments.offset + entries.length, hasMore: more } }, outputs: [] };
    }
    case 'file.mkdir': await mkdir(task.arguments.path, { recursive: task.arguments.recursive, mode: 0o700 }); return { result: { status: 'ok' }, outputs: [] };
    case 'file.remove': await rm(task.arguments.path, { recursive: task.arguments.recursive, force: false }); return { result: { status: 'ok' }, outputs: [] };
    case 'file.rename': {
      try { await lstat(task.arguments.destination); if (!task.arguments.overwrite) throw new Error('Destination exists; explicit overwrite is required'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(task.arguments.path, task.arguments.destination); return { result: { status: 'ok' }, outputs: [] };
    }
    case 'file.chmod': await chmod(task.arguments.path, task.arguments.mode); return { result: { status: 'ok' }, outputs: [] };
    case 'file.read': {
      const path = resolve(task.arguments.path);
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat(); if (!stat.isFile()) throw new Error('Not a regular file');
        const buffer = Buffer.alloc(task.arguments.length);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, task.arguments.offset);
        signal.throwIfAborted();
        return { result: { status: 'ok', data: { size: stat.size, offset: task.arguments.offset, bytesRead }, truncated: task.arguments.offset + bytesRead < stat.size }, outputs: [output('file', buffer.subarray(0, bytesRead))] };
      } finally { await file.close(); }
    }
    case 'file.write': {
      if (!write) throw new Error('Missing approved write snapshot');
      const path = resolve(task.arguments.path);
      if (realpathSync(dirname(path)) !== write.parent) throw new Error('Parent changed after approval');
      const fresh = prepareWrite(task)!;
      if (fresh.sha !== write.sha || (task.arguments.expectedSha256 && fresh.sha !== task.arguments.expectedSha256)) throw new Error('File changed since preview or expected hash does not match');
      const temp = join(write.parent, `.${basename(path)}.diagnose-${randomUUID()}`);
      const mode = fresh.sha === null ? 0o600 : lstatSync(path).mode & 0o777;
      try {
        const file = await open(temp, 'wx', mode);
        try { await file.writeFile(task.arguments.content); await file.sync(); } finally { await file.close(); }
        signal.throwIfAborted();
        if (prepareWrite(task)!.sha !== write.sha || realpathSync(dirname(path)) !== write.parent) throw new Error('Target changed before write');
        await rename(temp, path);
      } finally { await unlink(temp).catch(() => {}); }
      return { result: { status: 'ok', data: { path, bytesWritten: Buffer.byteLength(task.arguments.content), beforeSha256: write.sha, afterSha256: sha256(Buffer.from(task.arguments.content)) } }, outputs: [] };
    }
    case 'process.run': return runProcess(task.arguments, signal);
    case 'process.script': return runProcess({ ...task.arguments, executable: task.arguments.interpreter }, signal, task.arguments.script);
    case 'serial.capture': case 'serial.exchange': return capture(task, signal, serialState);
    default: throw new Error('This operation requires the session resource manager');
  }
}

export function killTree(child: ChildProcess, force = false): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true }); killer.on('error', () => {});
    } else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch { /* Child may already have exited. */ }
}
async function runProcess(args: Extract<AtomicTask, { operation: 'process.run' }>['arguments'], signal: AbortSignal, script?: string): Promise<Execution> {
  return new Promise(resolveResult => {
    const chunks: Record<string, Buffer[]> = { stdout: [], stderr: [] };
    let bytes = 0, truncated = false, timedOut = false, launchError: string | undefined;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(?:DIAGNOSE_|OWON_|NPM_TOKEN|NODE_AUTH_TOKEN)/i.test(key)) delete env[key];
    const child = spawn(args.executable, args.args, { cwd: args.cwd ?? process.cwd(), env, shell: false, detached: process.platform !== 'win32', stdio: [script === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true });
    if (script !== undefined) { child.stdin!.on('error', () => {}); child.stdin!.end(script); }
    let force: NodeJS.Timeout | undefined;
    const stop = (): void => { killTree(child); force ??= setTimeout(() => killTree(child, true), 1000); force.unref(); };
    const timeout = setTimeout(() => { timedOut = true; stop(); }, args.timeoutMs);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    for (const stream of ['stdout', 'stderr'] as const) child[stream]!.on('data', (chunk: Buffer) => {
      const keep = Math.min(chunk.length, MAX_OUTPUT - bytes);
      if (keep > 0) chunks[stream].push(Buffer.from(chunk.subarray(0, keep)));
      bytes += keep;
      if (keep < chunk.length) { truncated = true; stop(); }
    });
    child.on('error', error => { launchError = error.message; });
    child.on('close', code => {
      clearTimeout(timeout); signal.removeEventListener('abort', stop);
      // Kill descendants even when the immediate child exited first.
      killTree(child, true); if (force) clearTimeout(force);
      resolveResult({ result: { status: signal.aborted ? 'cancelled' : (code === 0 && !timedOut && !truncated && !launchError ? 'ok' : 'error'), exitCode: code, truncated, ...(timedOut ? { error: 'Task timeout' } : launchError ? { error: redact(launchError) } : {}) }, outputs: Object.entries(chunks).map(([name, data]) => output(name, Buffer.concat(data))) });
    });
  });
}

async function capture(task: Extract<Task, { operation: 'serial.capture' | 'serial.exchange' }>, signal: AbortSignal, serialState?: (state: SerialState) => void): Promise<Execution> {
  if (task.operation === 'serial.capture' && task.arguments.dataHex !== undefined) throw new Error('Capture does not accept transmit data');
  if (task.operation === 'serial.exchange' && !task.arguments.dataHex) throw new Error('Exchange requires explicit dataHex');
  if (task.operation === 'serial.exchange' && task.arguments.reattach) throw new Error('Only read-only serial capture can reattach');
  const { path, baudRate, durationMs, reattach } = task.arguments;
  let usbIdentity: string | undefined;
  const identity = (port: Awaited<ReturnType<typeof SerialPort.list>>[number]) => port.vendorId && port.productId && port.serialNumber
    ? [port.vendorId.toLowerCase(), port.productId.toLowerCase(), port.serialNumber].join(':') : undefined;
  if (reattach) {
    const ports = await SerialPort.list();
    const selected = ports.find(port => port.path === path);
    usbIdentity = selected && identity(selected);
    if (!usbIdentity || ports.filter(port => identity(port) === usbIdentity).length !== 1) throw new Error('USB reattachment requires one uniquely identified USB serial port');
  }
  signal.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false, truncated = false;
    let timer: NodeJS.Timeout | undefined, openTimer: NodeJS.Timeout | undefined, poll: NodeJS.Timeout | undefined;
    let port: SerialPort | undefined, waiting = false;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(openTimer); clearTimeout(poll); signal.removeEventListener('abort', abort);
      const settle = (): void => error ? reject(error) : resolveResult({
        result: { status: signal.aborted ? 'cancelled' : waiting ? 'error' : 'ok', ...(waiting ? { error: 'The same USB serial device did not return before the capture ended' } : {}), truncated, data: { bytesRead: size, mayHaveReset: true } },
        outputs: [output('serial', Buffer.concat(chunks))],
      });
      if (port?.isOpen) port.close(() => settle()); else settle();
    };
    const abort = (): void => finish();
    const retry = () => {
      poll = setTimeout(() => {
        void SerialPort.list().then(ports => {
          if (done) return;
          const matching = ports.filter(candidate => identity(candidate) === usbIdentity);
          if (matching.length === 1) attach(matching[0].path);
          else retry();
        }, () => { if (!done) retry(); });
      }, 300);
    };
    const attach = (serialPath: string) => {
      const current = port = new SerialPort({ path: serialPath, baudRate, autoOpen: false, rtscts: false, hupcl: false });
      const lost = (error?: Error) => {
        if (done || port !== current) return;
        if (!timer) { finish(error ?? new Error('Serial port closed before capture was ready')); return; }
        if (!reattach) { finish(error); return; }
        clearTimeout(openTimer);
        port = undefined;
        if (current.isOpen) current.close();
        if (!waiting) serialState?.('awaiting-serial-device');
        waiting = true;
        retry();
      };
      current.on('error', lost);
      current.on('close', () => lost());
      current.on('data', (chunk: Buffer) => {
        if (done || port !== current) return;
        const keep = Math.min(chunk.length, MAX_OUTPUT - size);
        chunks.push(Buffer.from(chunk.subarray(0, keep)));
        size += keep;
        if (keep < chunk.length) { truncated = true; finish(); }
      });
      openTimer = setTimeout(() => lost(new Error('Serial open timeout')), 10000);
      current.open(error => {
        if (done || port !== current) { if (current.isOpen) current.close(); return; }
        if (error) { lost(error); return; }
        current.set({ dtr: false, rts: false }, setError => {
          if (done || port !== current) return;
          clearTimeout(openTimer);
          if (setError) { lost(setError); return; }
          if (signal.aborted) { finish(); return; }
          timer ??= setTimeout(() => finish(), durationMs);
          waiting = false;
          serialState?.('serial-ready');
          if (task.operation === 'serial.exchange') current.write(Buffer.from(task.arguments.dataHex!, 'hex'), writeError => { if (writeError) finish(writeError); });
        });
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    attach(path);
  });
}
