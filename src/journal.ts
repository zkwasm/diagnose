import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, appendFileSync, readSync, statSync, renameSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { CHUNK_SIZE } from './schema.js';

export type ResourceMeta = { id: string; kind: 'process' | 'upload' | 'download' | 'forward' | 'tcp'; state: string; createdAt: string; updatedAt: string; ownerPid: number; tokenHash: string; retainOnDisconnect: boolean; [key: string]: unknown };
export type OutputRecord = { stream: string; data: string };
export const retention = { maxBytes: 256 * 1024 * 1024, maxEntries: 2000, maxAgeMs: 7 * 86400000 };
export type JournalLimits = typeof retention;
export function live(meta: ResourceMeta): boolean {
  if (!['running', 'open', 'listening'].includes(meta.state) || meta.ownerPid <= 0) return false;
  try { process.kill(meta.ownerPid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
export class Journal {
  private key: Buffer;
  private bytes = 0;
  private entries = 0;
  private checkedAt = 0;
  constructor(readonly root: string, private limits?: JournalLimits) {
    mkdirSync(root, { recursive: true, mode: 0o700 }); const path = join(root, 'key');
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.key = readFileSync(path); if (this.key.length !== 32) throw new Error('Invalid local journal key');
    if (limits) this.cleanup();
  }
  list(): ResourceMeta[] { return readdirSync(this.root).filter(name => /^[a-f0-9-]{36}\.meta$/.test(name)).map(name => this.load(name.slice(0, -5))); }
  cleanup(limits = this.limits ?? retention, keep?: string): { removed: number; bytes: number; entries: number } {
    const records = this.list().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const size = (id: string): number => ['.meta', '.log', '.meta.tmp'].reduce((total, ext) => { try { return total + statSync(this.path(id, ext)).size; } catch { return total; } }, 0);
    this.bytes = records.reduce((total, meta) => total + size(meta.id), 0); this.entries = records.length;
    let removed = 0;
    for (const meta of records) {
      if (meta.id === keep || live(meta)) continue;
      if (Date.now() - Date.parse(meta.updatedAt) < limits.maxAgeMs && this.bytes <= limits.maxBytes && this.entries <= limits.maxEntries) continue;
      const count = size(meta.id);
      // Only remove our own abandoned upload staging file, never its target.
      if (meta.kind === 'upload' && typeof meta.temp === 'string' && typeof meta.path === 'string' && meta.temp === join(dirname(meta.path), `.${basename(meta.path)}.diagnose-${meta.id}`)) { try { unlinkSync(meta.temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      for (const ext of ['.meta', '.log', '.meta.tmp']) { try { unlinkSync(this.path(meta.id, ext)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      this.bytes -= count; this.entries--; removed++;
    }
    this.checkedAt = Date.now(); return { removed, bytes: this.bytes, entries: this.entries };
  }
  private reserve(bytes: number, id: string, newEntry = false): void {
    if (!this.limits) return;
    if (Date.now() - this.checkedAt > 60000 || this.bytes + bytes > this.limits.maxBytes || this.entries + Number(newEntry) > this.limits.maxEntries) this.cleanup({ ...this.limits, maxBytes: this.limits.maxBytes - Math.max(0, bytes), maxEntries: this.limits.maxEntries - Number(newEntry) }, id);
    if (this.bytes + bytes > this.limits.maxBytes || this.entries + Number(newEntry) > this.limits.maxEntries) throw new Error('Local encrypted storage quota reached; close retained jobs and run diagnose cleanup');
    this.bytes += bytes; this.entries += Number(newEntry);
  }
  private path(id: string, extension: string): string { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid resource ID'); return join(this.root, id + extension); }
  private seal(id: string, bytes: Buffer): Buffer {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  private unseal(id: string, bytes: Buffer): Buffer {
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12)); cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
  }
  save(meta: ResourceMeta): void { meta.updatedAt = new Date().toISOString(); const path = this.path(meta.id, '.meta'); const temp = path + '.tmp'; const bytes = this.seal(meta.id, Buffer.from(JSON.stringify(meta))); const exists = existsSync(path); this.reserve(bytes.length - (exists ? statSync(path).size : 0), meta.id, !exists); writeFileSync(temp, bytes, { mode: 0o600, flush: true }); renameSync(temp, path); }
  load(id: string): ResourceMeta { return JSON.parse(this.unseal(id, readFileSync(this.path(id, '.meta'))).toString()); }
  exists(id: string): boolean { return existsSync(this.path(id, '.meta')); }
  append(id: string, stream: string, bytes: Buffer): void {
    const records: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const record = this.seal(id, Buffer.from(JSON.stringify({ stream, data: bytes.subarray(offset, offset + CHUNK_SIZE).toString('base64') })));
      const header = Buffer.alloc(4); header.writeUInt32BE(record.length); records.push(header, record);
    }
    const payload = Buffer.concat(records);
    this.reserve(payload.length, id); appendFileSync(this.path(id, '.log'), payload, { mode: 0o600 });
  }
  read(id: string, cursor = 0, limit = 65536): { records: OutputRecord[]; cursor: number; hasMore: boolean } {
    const path = this.path(id, '.log'); if (!existsSync(path)) return { records: [], cursor: 0, hasMore: false };
    const size = statSync(path).size; if (cursor > size) throw new Error('Output cursor is beyond stored data');
    const fd = openSync(path, 'r'); const records: OutputRecord[] = []; let bytes = 0;
    try {
      while (cursor + 4 <= size && bytes < limit) {
        const header = Buffer.alloc(4); readSync(fd, header, 0, 4, cursor); const length = header.readUInt32BE();
        if (length < 28 || length > 128 * 1024 || cursor + 4 + length > size) throw new Error('Invalid or incomplete journal record');
        const block = Buffer.alloc(length); readSync(fd, block, 0, length, cursor + 4);
        const record: OutputRecord = JSON.parse(this.unseal(id, block).toString()); const count = Buffer.from(record.data, 'base64').length;
        if (records.length && bytes + count > limit) break;
        records.push(record); bytes += count; cursor += 4 + length;
      }
      return { records, cursor, hasMore: cursor < size };
    } finally { closeSync(fd); }
  }
}
