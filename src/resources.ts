import { spawn as spawnProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath, rename, unlink, link } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import net from 'node:net';
import { Journal, retention, type ResourceMeta } from './journal.js';
import { killTree } from './executor.js';
import { Audit, sha256 } from './util.js';
import type { AtomicTask, ResourceRequest } from './schema.js';
import { preparePty } from './prepare-pty.js';

type Resource = { meta: ResourceMeta; owner: string; input?: (bytes: Buffer, eof: boolean) => Promise<void>; resize?: (cols: number, rows: number) => void; signal?: (signal: string) => void; read?: (request: ResourceRequest) => Promise<unknown>; control?: (request: ResourceRequest) => Promise<unknown>; close: () => Promise<void> | void };
const supported = new Set(['process.open', 'file.transfer', 'resource.resume', 'net.forward']);
export const resourceOperation = (operation: string): boolean => supported.has(operation);
const publicMeta = (meta: ResourceMeta): Record<string, unknown> => Object.fromEntries(Object.entries(meta).filter(([key]) => !['tokenHash', 'temp', 'parent', 'beforeSha256', 'mode'].includes(key)));
async function fileHash(path: string): Promise<string> { const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); try { const hash = createHash('sha256'); for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); } finally { await file.close(); } }
async function currentHash(path: string): Promise<string | null> { try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Target must be a regular, non-symlink file'); return await fileHash(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }

export class SessionResources {
  readonly journal: Journal;
  private resources = new Map<string, Resource>();
  private writes = new Map<string, Promise<unknown>>();
  constructor(root: string, private audit: Audit) { this.journal = new Journal(root, retention); }
  setAudit(audit: Audit): void { this.audit = audit; }
  private create(id: string, kind: ResourceMeta['kind'], owner: string, retainOnDisconnect: boolean, details: Record<string, unknown> = {}): { resource: Resource; token: string } {
    for (const [key, value] of this.resources) {
      if (!['running', 'open', 'listening'].includes(value.meta.state) && (!this.journal.exists(key) || this.resources.size >= 256)) this.resources.delete(key);
    }
    if (this.resources.has(id) || this.journal.exists(id)) throw new Error('Resource ID already exists. Resume it; do not replay its creation.');
    if ([...this.resources.values()].filter(r => ['running', 'open', 'listening'].includes(r.meta.state)).length >= 128) throw new Error('Active resource limit reached; close unused resources');
    const token = randomBytes(32).toString('base64url'), now = new Date().toISOString();
    const meta: ResourceMeta = { id, kind, state: 'open', createdAt: now, updatedAt: now, ownerPid: process.pid, tokenHash: sha256(Buffer.from(token)), retainOnDisconnect, ...details };
    const resource: Resource = { meta, owner, close: () => { meta.state = 'closed'; this.journal.save(meta); } };
    this.resources.set(id, resource); this.journal.save(meta); return { resource, token };
  }
  async open(task: AtomicTask, owner: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    if (task.operation === 'process.open') return this.startProcess(task, owner, signal);
    if (task.operation === 'file.transfer') return this.startTransfer(task, owner, signal);
    if (task.operation === 'net.forward') return this.startForward(task, owner, signal);
    if (task.operation === 'resource.resume') {
      const { id, resumeToken } = task.arguments; let resource = this.resources.get(id); const meta = resource?.meta ?? this.journal.load(id);
      if (!timingSafeEqual(Buffer.from(meta.tokenHash, 'hex'), createHash('sha256').update(resumeToken).digest())) throw new Error('Invalid resource recovery credential');
      if (!resource) {
        if (meta.kind === 'upload' || meta.kind === 'download') resource = await this.restoreTransfer(meta, owner);
        else if (meta.kind === 'process') { if (meta.state === 'running') { meta.state = 'interrupted'; meta.recoveryNote = 'Original host process is unavailable here. Stored output is recoverable; the command is never replayed.'; this.journal.save(meta); } resource = { meta, owner, close: () => {} }; }
        else throw new Error('Network connections cannot survive host restart; create a new forward');
        this.resources.set(id, resource);
      }
      if (signal?.aborted) { await resource.close(); signal.throwIfAborted(); }
      resource.owner = owner; this.audit.record('resource.resumed', { id, kind: meta.kind }); return publicMeta(meta);
    }
    throw new Error('Unsupported resource operation');
  }
  async control(owner: string, request: ResourceRequest): Promise<unknown> {
    if (request.id && ['input', 'commit'].includes(request.action)) {
      const id = request.id, result = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.controlOne(owner, request));
      this.writes.set(id, result); void result.finally(() => { if (this.writes.get(id) === result) this.writes.delete(id); }).catch(() => {}); return result;
    }
    return this.controlOne(owner, request);
  }
  private async controlOne(owner: string, request: ResourceRequest): Promise<unknown> {
    if (request.action === 'list') return { resources: [...this.resources.values()].filter(r => r.owner === owner).map(r => publicMeta(r.meta)) };
    const resource = this.resources.get(request.id ?? ''); if (!resource || resource.owner !== owner) throw new Error('Resource is not attached to this connection. Resume it with its ID and recovery credential first.');
    const { meta } = resource;
    if (request.action === 'status') return publicMeta(meta);
    if (request.action === 'read') {
      const stored = resource.read ? undefined : this.journal.read(meta.id, request.cursor, request.limit);
      const value = resource.read ? await resource.read(request) : { ...stored, resource: publicMeta(meta), ended: meta.state !== 'running' && !stored!.hasMore };
      if (resource.owner !== owner) throw new Error('Resource authorization was revoked');
      this.audit.record('resource.read-sending', { id: meta.id, kind: meta.kind, cursor: request.cursor, responseBytes: Buffer.byteLength(JSON.stringify(value)) }); return value;
    }
    if (request.action !== 'close' && !['running', 'open', 'listening'].includes(meta.state)) throw new Error('Resource has finished or closed; only status/read are available');
    if (request.action === 'input') {
      if (!resource.input) throw new Error('This resource does not accept input'); const bytes = Buffer.from(request.data ?? '', 'base64');
      if (bytes.length > 65536 || bytes.toString('base64') !== (request.data ?? '')) throw new Error('Invalid input encoding');
      this.audit.record('resource.input', { id: meta.id, bytes: bytes.length, eof: request.eof });
      if (meta.kind === 'process') this.audit.history.event(meta.id, 'process-input', { encoding: 'base64', data: bytes.toString('base64'), eof: request.eof });
      await resource.input(bytes, request.eof); return { acceptedBytes: bytes.length };
    }
    if (request.action === 'resize') { if (!resource.resize || !request.cols || !request.rows) throw new Error('Resize requires a PTY and dimensions'); this.audit.record('resource.resize', { id: meta.id, cols: request.cols, rows: request.rows }); resource.resize(request.cols, request.rows); return publicMeta(meta); }
    if (request.action === 'signal') { if (!resource.signal) throw new Error('Not a running process'); const signal = request.signal ?? 'SIGINT'; this.audit.record('resource.signal', { id: meta.id, signal }); resource.signal(signal); return { signalled: true }; }
    if (request.action === 'close') { this.audit.record('resource.close', { id: meta.id }); await resource.close(); return publicMeta(meta); }
    if (resource.control) return resource.control(request);
    throw new Error('Unsupported resource action');
  }
  private async startProcess(task: Extract<AtomicTask, { operation: 'process.open' }>, owner: string, signal?: AbortSignal): Promise<unknown> {
    const args = task.arguments, executable = args.executable ?? (process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL ?? '/bin/sh');
    const { resource, token } = this.create(task.id, 'process', owner, args.retainOnDisconnect, { state: 'running', executable, cwd: resolve(args.cwd ?? process.cwd()), pty: args.pty, cols: args.cols, rows: args.rows, bytes: 0 });
    const { meta } = resource; const env = { ...process.env, ...args.env }; for (const key of Object.keys(env)) if (/^(?:DIAGNOSE_|OWON_|NPM_TOKEN|NODE_AUTH_TOKEN)/i.test(key)) delete env[key];
    let timer: NodeJS.Timeout | undefined, closing: Promise<void> | undefined;
    // A leader exiting does not mean its process group has exited. Clean up
    // immediately, while the group ID still belongs to this job.
    const ended = (code: number | null, signal?: number | string): void => { resource.signal?.('SIGKILL'); clearTimeout(timer); meta.state = 'exited'; meta.exitCode = code; if (signal !== undefined) meta.signal = signal; this.journal.save(meta); this.audit.record('resource.process-exited', { id: meta.id, exitCode: code }); };
    const collect = (stream: string, bytes: Buffer): void => {
      try {
        const keep = Math.max(0, Math.min(bytes.length, args.maxOutputBytes - Number(meta.bytes))); if (keep) this.journal.append(meta.id, stream, bytes.subarray(0, keep)); meta.bytes = Number(meta.bytes) + keep;
        if (keep < bytes.length) { meta.truncated = true; resource.signal?.('SIGKILL'); }
      } catch (error) { meta.error = (error as Error).message; resource.signal?.('SIGKILL'); }
    };
    try {
      if (args.pty) {
        await preparePty();
        const pty = await import('node-pty'); signal?.throwIfAborted(); if (resource.owner !== owner) throw new Error('Resource authorization was revoked'); const child = pty.spawn(executable, args.args, { name: 'xterm-256color', cols: args.cols, rows: args.rows, cwd: String(meta.cwd), env, encoding: null }); meta.pid = child.pid;
        child.onData(value => collect('terminal', Buffer.isBuffer(value) ? value : Buffer.from(value))); child.onExit(value => ended(value.exitCode, value.signal));
        resource.input = async (bytes, eof) => { child.write(bytes.toString('utf8')); if (eof) child.write('\x04'); };
        resource.resize = (cols, rows) => { child.resize(cols, rows); meta.cols = cols; meta.rows = rows; this.journal.save(meta); };
        resource.signal = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal as NodeJS.Signals); } catch {} };
      } else {
        const child = spawnProcess(executable, args.args, { cwd: String(meta.cwd), env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); meta.pid = child.pid;
        child.stdout.on('data', bytes => collect('stdout', bytes)); child.stderr.on('data', bytes => collect('stderr', bytes)); child.stdin.on('error', () => {});
        child.on('error', error => { meta.error = error.message; meta.state = 'failed'; this.journal.save(meta); }); child.on('exit', (code, signal) => ended(code, signal ?? undefined));
        resource.input = (bytes, eof) => new Promise((resolveInput, reject) => { if (child.stdin.destroyed || child.stdin.writableEnded) { reject(new Error('Process stdin is closed')); return; } if (eof) child.stdin.end(bytes, resolveInput); else child.stdin.write(bytes, error => error ? reject(error) : resolveInput()); });
        resource.signal = signal => { if (process.platform === 'win32') killTree(child, signal === 'SIGKILL'); else { try { process.kill(-child.pid!, signal as NodeJS.Signals); } catch {} } };
      }
      resource.close = () => {
        if (closing) return closing;
        if (meta.state !== 'running') return;
        resource.signal?.('SIGTERM');
        closing = new Promise<void>(resolveClose => setTimeout(() => {
          if (meta.state === 'running') resource.signal?.('SIGKILL');
          resolveClose();
        }, 1000));
        return closing;
      };
      if (args.timeoutMs) { timer = setTimeout(() => { meta.timedOut = true; void resource.close(); }, args.timeoutMs); timer.unref(); }
      this.journal.save(meta); this.audit.record('resource.process-started', { id: meta.id, pid: meta.pid, pty: args.pty, retainOnDisconnect: args.retainOnDisconnect });
      return { ...publicMeta(meta), resumeToken: token, output: 'Raw, unredacted bytes. Poll read from cursor 0 for live output; input/resize/signals are authorized for this handle.' };
    } catch (error) { meta.state = 'failed'; meta.error = (error as Error).message; this.journal.save(meta); throw error; }
  }
  private async startTransfer(task: Extract<AtomicTask, { operation: 'file.transfer' }>, owner: string, signal?: AbortSignal): Promise<unknown> {
    const args = task.arguments, path = resolve(args.path); let details: Record<string, unknown>;
    if (args.direction === 'download') { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Download requires a regular non-symlink file'); details = { path, size: stat.size, sha256: await fileHash(path), offset: 0 }; }
    else { if (args.size === undefined || !args.sha256) throw new Error('Upload requires exact size and SHA-256'); const before = await currentHash(path); if (before !== null && !args.overwrite) throw new Error('Target exists; explicit overwrite authorization required'); details = { path, parent: await realpath(dirname(path)), temp: join(dirname(path), `.${basename(path)}.diagnose-${task.id}`), beforeSha256: before, mode: before === null ? 0o600 : (await lstat(path)).mode & 0o777, size: args.size, sha256: args.sha256, offset: 0 }; }
    signal?.throwIfAborted(); const { resource, token } = this.create(task.id, args.direction, owner, args.retainOnDisconnect, details);
    const live = await this.restoreTransfer(resource.meta, owner, true); if (signal?.aborted || resource.owner !== owner) { await live.close(); throw new Error('Transfer authorization was cancelled'); } this.resources.set(task.id, live);
    this.audit.record('resource.transfer-opened', { id: task.id, direction: args.direction, path, size: details.size }); return { ...publicMeta(live.meta), resumeToken: token, encoding: 'base64', redaction: 'none; exact file bytes' };
  }
  private async restoreTransfer(meta: ResourceMeta, owner: string, fresh = false): Promise<Resource> {
    if (meta.state !== 'open') return { meta, owner, close: () => {} };
    const upload = meta.kind === 'upload';
    if (upload && await realpath(dirname(String(meta.path))) !== meta.parent) throw new Error('Transfer parent changed');
    const file = await open(String(upload ? meta.temp : meta.path), upload ? fresh ? 'wx+' : constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    if (upload && !fresh && (await file.stat()).size !== meta.offset) { await file.close(); throw new Error('Partial upload size changed'); }
    let closed = false;
    const resource: Resource = { meta, owner, close: async () => { if (!closed) { closed = true; await file.close(); } if (upload) await unlink(String(meta.temp)).catch(() => {}); meta.state = 'closed'; this.journal.save(meta); } };
    if (!upload) resource.read = async request => { const bytes = Buffer.alloc(Math.min(request.limit, Math.max(0, Number(meta.size) - request.cursor))); const read = await file.read(bytes, 0, bytes.length, request.cursor); return { data: bytes.subarray(0, read.bytesRead).toString('base64'), offset: request.cursor, nextOffset: request.cursor + read.bytesRead, ended: request.cursor + read.bytesRead >= Number(meta.size), size: meta.size, sha256: meta.sha256 }; };
    else {
      resource.input = async bytes => { if (closed) throw new Error('Upload closed'); if (Number(meta.offset) + bytes.length > Number(meta.size)) throw new Error('Upload exceeds declared size'); let written = 0; while (written < bytes.length) { const result = await file.write(bytes, written, bytes.length - written, Number(meta.offset) + written); if (!result.bytesWritten) throw new Error('Upload write made no progress'); written += result.bytesWritten; } meta.offset = Number(meta.offset) + bytes.length; this.journal.save(meta); };
      resource.control = async request => {
        if (request.action !== 'commit') throw new Error('Unsupported transfer action');
        if (meta.offset !== meta.size) throw new Error('Upload is incomplete'); await file.sync();
        if (await fileHash(String(meta.temp)) !== meta.sha256) throw new Error('Upload SHA-256 mismatch; destination untouched');
        if (await realpath(dirname(String(meta.path))) !== meta.parent || await currentHash(String(meta.path)) !== meta.beforeSha256) throw new Error('Destination changed since upload authorization');
        if (closed || resource.owner !== owner) throw new Error('Transfer authorization was revoked');
        await file.chmod(Number(meta.mode ?? 0o600)); await file.close();
        if (closed || resource.owner !== owner) throw new Error('Transfer authorization was revoked');
        closed = true;
        if (meta.beforeSha256 === null) { await link(String(meta.temp), String(meta.path)); await unlink(String(meta.temp)); }
        else await rename(String(meta.temp), String(meta.path));
        meta.state = 'committed'; this.journal.save(meta); this.audit.record('resource.file-changed', { id: meta.id, path: meta.path, beforeSha256: meta.beforeSha256, afterSha256: meta.sha256, bytes: meta.size }); return publicMeta(meta);
      };
    }
    return resource;
  }
  private tcp(socket: net.Socket, owner: string, parentId: string): Resource {
    const { resource } = this.create(randomUUID(), 'tcp', owner, false, { parentId, state: 'open', bytesRead: 0, bytesWritten: 0 }); let chunks: Buffer[] = [], size = 0, ended = false;
    socket.on('data', chunk => { chunks.push(Buffer.from(chunk)); size += chunk.length; resource.meta.bytesRead = Number(resource.meta.bytesRead) + chunk.length; if (size > 256 * 1024) socket.pause(); });
    socket.on('end', () => { ended = true; }); socket.on('close', () => { ended = true; resource.meta.state = 'closed'; this.journal.save(resource.meta); }); socket.on('error', error => { resource.meta.error = error.message; ended = true; });
    resource.read = async request => { const count = Math.min(size, request.limit), result = Buffer.alloc(count); let offset = 0; while (offset < count) { const chunk = chunks[0], keep = Math.min(chunk.length, count - offset); chunk.copy(result, offset, 0, keep); if (keep === chunk.length) chunks.shift(); else chunks[0] = chunk.subarray(keep); offset += keep; } size -= count; if (size < 128 * 1024 && !ended) socket.resume(); return { data: result.toString('base64'), ended: ended && size === 0 }; };
    resource.input = (bytes, eof) => new Promise((resolveInput, reject) => { if (socket.destroyed) { reject(new Error('TCP connection closed')); return; } resource.meta.bytesWritten = Number(resource.meta.bytesWritten) + bytes.length; if (eof) socket.end(bytes, resolveInput); else socket.write(bytes, error => error ? reject(error) : resolveInput()); });
    resource.close = () => { chunks = []; size = 0; socket.destroy(); }; return resource;
  }
  private async startForward(task: Extract<AtomicTask, { operation: 'net.forward' }>, owner: string, signal?: AbortSignal): Promise<unknown> {
    const args = task.arguments; if (args.direction !== 'socks' && !args.port) throw new Error('A fixed target port is required');
    const { resource, token } = this.create(task.id, 'forward', owner, false, { ...args, state: args.direction === 'remote' ? 'listening' : 'open' }); let server: net.Server | undefined; const pending: string[] = [];
    if (args.direction === 'remote') {
      server = net.createServer({ allowHalfOpen: true }, socket => { if (signal?.aborted || resource.owner !== owner || pending.length >= 32) { socket.destroy(); return; } try { pending.push(this.tcp(socket, resource.owner, task.id).meta.id); } catch { socket.destroy(); } });
      server.on('error', error => { resource.meta.error = error.message; }); await new Promise<void>((resolveListen, reject) => { server!.once('error', reject); server!.listen(args.bindPort, args.bindHost, () => { server!.off('error', reject); resolveListen(); }); }); resource.meta.listeningPort = (server.address() as net.AddressInfo).port;
    }
    if (signal?.aborted || resource.owner !== owner) { server?.close(); resource.meta.state = 'closed'; this.journal.save(resource.meta); throw new Error('Forward authorization was cancelled'); }
    resource.control = async request => {
      if (request.action === 'accept' && server) return { connections: pending.splice(0, 16) };
      if (request.action !== 'connect' || server) throw new Error('Unsupported forwarding action');
      const host = args.direction === 'socks' ? request.host : args.host, port = args.direction === 'socks' ? request.port : args.port;
      if (!host || !port || (args.direction === 'socks' && !args.allowedHosts.includes('*') && !args.allowedHosts.includes(host))) throw new Error('Destination is outside the authorized forwarding scope');
      const socket = net.createConnection({ host, port, allowHalfOpen: true }); await new Promise<void>((resolveConnect, reject) => { socket.once('connect', resolveConnect); socket.once('error', reject); socket.setTimeout(10000, () => socket.destroy(new Error('TCP connect timeout'))); }); socket.setTimeout(0);
      if (resource.owner !== owner || resource.meta.state === 'closed') { socket.destroy(); throw new Error('Forward authorization was revoked'); }
      const child = this.tcp(socket, resource.owner, task.id); this.audit.record('resource.tcp-connected', { id: child.meta.id, parentId: task.id, host, port }); return publicMeta(child.meta);
    };
    resource.close = async () => { server?.close(); for (const child of this.resources.values()) if (child.meta.parentId === task.id) await child.close(); resource.meta.state = 'closed'; this.journal.save(resource.meta); };
    this.journal.save(resource.meta); return { ...publicMeta(resource.meta), resumeToken: token };
  }
  async disconnect(owner: string): Promise<void> { const affected = [...this.resources.values()].filter(resource => resource.owner === owner); for (const resource of affected) resource.owner = ''; await Promise.all(affected.filter(resource => !resource.meta.retainOnDisconnect).map(resource => resource.close())); }
  async abandon(task: AtomicTask, owner: string): Promise<void> { const id = task.operation === 'resource.resume' ? task.arguments.id : task.id, resource = this.resources.get(id); if (resource?.owner === owner) { resource.owner = ''; if (task.operation !== 'resource.resume' || !resource.meta.retainOnDisconnect) await resource.close(); } }
  async revoke(owner?: string): Promise<void> { const affected = [...this.resources.values()].filter(resource => owner === undefined || resource.owner === owner); for (const resource of affected) resource.owner = ''; await Promise.all(affected.map(resource => resource.close())); }
  listLocal(): Record<string, unknown>[] { return [...this.resources.values()].map(resource => publicMeta(resource.meta)); }
  async localInput(id: string, value: Buffer): Promise<void> { const resource = this.resources.get(id); if (!resource?.input || resource.meta.state !== 'running') throw new Error('No live process with this ID'); this.audit.record('resource.local-input', { id, bytes: value.length }); await resource.input(value, false); }
  renewCredential(id: string): string { const meta = this.resources.get(id)?.meta ?? this.journal.load(id); const token = randomBytes(32).toString('base64url'); meta.tokenHash = sha256(Buffer.from(token)); this.journal.save(meta); this.audit.record('resource.local-credential-renewed', { id }); return token; }
  get hasRetained(): boolean { return [...this.resources.values()].some(r => r.meta.retainOnDisconnect && ['running', 'open'].includes(r.meta.state)); }
}
