import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_VAULT_OBJECT } from './vault-crypto.js';

// Opaque capability-authenticated immutable objects. No encryption key reaches
// this module. One relay process owns the store; do not use PM2 cluster mode.
export class VaultServer {
  private activeUploads = 0;
  private requests = new Map<string, { since: number; count: number }>();
  constructor(readonly root: string, readonly maxTotalBytes = 1024 ** 3) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // No interrupted request is published: abandoned staging files are disposable.
    for (const name of readdirSync(root)) if (/^[a-f0-9]{64}$/.test(name)) for (const file of readdirSync(join(root, name))) if (file.startsWith('.upload-')) rmSync(join(root, name, file), { force: true });
  }
  private inventory(directory: string): { id: string; bytes: number }[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(name => /^[a-f0-9]{64}$/.test(name)).map(id => ({ id, bytes: statSync(join(directory, id)).size }));
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const direct = req.socket.remoteAddress ?? 'unknown';
      const ip = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct) ? String(req.headers['x-forwarded-for'] ?? direct).split(',')[0].trim() : direct;
      for (const [key, rate] of this.requests) if (Date.now() - rate.since > 60000) this.requests.delete(key);
      if (!this.requests.has(ip) && this.requests.size >= 10000) { send(429, { error: 'Rate limit' }); return; }
      const rate = this.requests.get(ip) ?? { since: Date.now(), count: 0 }; this.requests.set(ip, rate);
      if (++rate.count > 600) { send(429, { error: 'Rate limit' }); return; }
      const auth = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      if (!auth) { send(401, { error: 'Library capability required' }); return; }
      const namespace = createHash('sha256').update(auth[1]).digest('hex'), directory = join(this.root, namespace);
      if (existsSync(join(this.root, namespace + '.revoked'))) { send(403, { error: 'Library revoked' }); return; }
      const match = /^\/v1\/library(?:\/([a-f0-9]{64}))?$/.exec(req.url ?? '');
      if (!match) { send(404, { error: 'Not found' }); return; }
      const id = match[1];
      if (req.method === 'GET') {
        if (!id) { send(200, { objects: this.inventory(directory) }); return; }
        const path = join(directory, id);
        if (!existsSync(path)) { send(404, { error: 'Not found' }); return; }
        const bytes = readFileSync(path); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }); res.end(bytes); return;
      }
      if (req.method === 'DELETE' && !id) {
        if (!existsSync(directory)) { send(404, { error: 'Library not found' }); return; }
        writeFileSync(join(this.root, namespace + '.revoked'), '', { mode: 0o600, flush: true }); rmSync(directory, { recursive: true, force: true }); send(200, { revoked: true }); return;
      }
      if (req.method !== 'PUT' || !id) { send(405, { error: 'Use GET, PUT object or DELETE library' }); return; }
      const length = Number(req.headers['content-length']);
      if (!Number.isInteger(length) || length < 29 || length > MAX_VAULT_OBJECT) { send(413, { error: 'Content-Length required, 29 bytes..12 MiB' }); return; }
      if (this.activeUploads >= 2) { send(429, { error: 'Upload capacity reached' }); return; }
      if (existsSync(join(directory, id))) { send(409, { error: 'Immutable object already exists' }); return; }
      this.activeUploads++;
      try {
        const chunks: Buffer[] = []; let size = 0;
        req.setTimeout(30000, () => req.destroy());
        for await (const chunk of req) { size += chunk.length; if (size > length) throw new Error('Size mismatch'); chunks.push(Buffer.from(chunk)); }
        if (size !== length) throw new Error('Incomplete upload');
        // Commit checks are synchronous so concurrent requests cannot overrun quota.
        if (existsSync(join(this.root, namespace + '.revoked'))) { send(403, { error: 'Library revoked' }); return; }
        const own = this.inventory(directory), names = readdirSync(this.root).filter(name => /^[a-f0-9]{64}(?:\.revoked)?$/.test(name));
        const total = names.filter(name => !name.endsWith('.revoked')).reduce((sum, name) => sum + this.inventory(join(this.root, name)).reduce((n, item) => n + item.bytes, 0), 0);
        if (own.length >= 128 || own.reduce((n, item) => n + item.bytes, 0) + size > 128 * 1024 ** 2 || total + size > this.maxTotalBytes || (!existsSync(directory) && names.length >= 1000)) { send(507, { error: 'Library storage quota reached' }); return; }
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (existsSync(join(directory, id))) { send(409, { error: 'Immutable object already exists' }); return; }
        const path = join(directory, '.upload-' + randomUUID());
        try { writeFileSync(path, Buffer.concat(chunks), { flag: 'wx', mode: 0o600, flush: true }); renameSync(path, join(directory, id)); }
        finally { if (existsSync(path)) unlinkSync(path); }
        send(201, { stored: true });
      } finally { this.activeUploads--; }
    } catch { if (!res.headersSent && !res.destroyed) send(400, { error: 'Library request failed' }); else res.destroy(); }
  }
}
