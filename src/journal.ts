import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, appendFileSync, readSync, statSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHUNK_SIZE } from './schema.js';

export type ResourceMeta = { id: string; kind: 'process' | 'upload' | 'download' | 'forward' | 'tcp'; state: string; createdAt: string; updatedAt: string; ownerPid: number; tokenHash: string; retainOnDisconnect: boolean; [key: string]: unknown };
export type OutputRecord = { stream: string; data: string };
export class Journal {
  private key: Buffer;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 }); const path = join(root, 'key');
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.key = readFileSync(path); if (this.key.length !== 32) throw new Error('Invalid local journal key');
  }
  private path(id: string, extension: string): string { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid resource ID'); return join(this.root, id + extension); }
  private seal(id: string, bytes: Buffer): Buffer {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  private unseal(id: string, bytes: Buffer): Buffer {
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12)); cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
  }
  save(meta: ResourceMeta): void { meta.updatedAt = new Date().toISOString(); const path = this.path(meta.id, '.meta'); const temp = path + '.tmp'; writeFileSync(temp, this.seal(meta.id, Buffer.from(JSON.stringify(meta))), { mode: 0o600, flush: true }); renameSync(temp, path); }
  load(id: string): ResourceMeta { return JSON.parse(this.unseal(id, readFileSync(this.path(id, '.meta'))).toString()); }
  exists(id: string): boolean { return existsSync(this.path(id, '.meta')); }
  append(id: string, stream: string, bytes: Buffer): void {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const record = this.seal(id, Buffer.from(JSON.stringify({ stream, data: bytes.subarray(offset, offset + CHUNK_SIZE).toString('base64') })));
      const header = Buffer.alloc(4); header.writeUInt32BE(record.length); appendFileSync(this.path(id, '.log'), Buffer.concat([header, record]), { mode: 0o600 });
    }
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
