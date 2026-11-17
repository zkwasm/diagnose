import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SkillLibrary } from './skill-library.js';
import { MAX_VAULT_OBJECT, newRecovery, vaultKeys, objectId, sealBundle, openBundle } from './vault-crypto.js';

export class Vault {
  constructor(readonly library = new SkillLibrary(), readonly root = join(homedir(), '.diagnose', 'vault'), readonly relay = 'https://diagnose.fenginwind.com') {
    const url = new URL(relay);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Library relay must be an HTTPS origin (HTTP allowed only for loopback tests)');
  }
  private async key(): Promise<string> { const value = (await readFile(join(this.root, 'recovery'), 'utf8')).trim(); vaultKeys(value); return value; }
  async initialize(recovery = newRecovery()): Promise<void> {
    vaultKeys(recovery); await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(join(this.root, 'recovery'), recovery + '\n', { flag: 'wx', mode: 0o600, flush: true });
  }
  async backup(path: string): Promise<void> { await writeFile(path, await this.key() + '\n', { flag: 'wx', mode: 0o600, flush: true }); }
  private async request(method: string, suffix = '', body?: Buffer): Promise<Buffer> {
    const auth = vaultKeys(await this.key()).auth;
    const response = await fetch(new URL('/v1/library' + suffix, this.relay), { method, headers: { Authorization: 'Bearer ' + auth, ...(body ? { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) } : {}) }, body: body ? new Uint8Array(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(45000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Library ${method} failed (${response.status}); no action was retried`); }
    const chunks: Buffer[] = []; let total = 0;
    if (response.body) for await (const chunk of response.body) { total += chunk.length; if (total > MAX_VAULT_OBJECT) throw new Error('Library response too large'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  }
  async list(): Promise<{ id: string; bytes: number }[]> {
    const response = JSON.parse((await this.request('GET')).toString());
    if (!Array.isArray(response.objects) || response.objects.length > 128 || response.objects.some((item: { id?: unknown; bytes?: number }) => typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || !Number.isInteger(item.bytes) || item.bytes! > MAX_VAULT_OBJECT || item.bytes! < 29)) throw new Error('Invalid library inventory');
    return response.objects;
  }
  async push(reference: string): Promise<void> {
    const recovery = await this.key(), bundle = await this.library.bundle(reference), id = objectId(recovery, reference);
    const existing = (await this.list()).some(item => item.id === id);
    if (existing) {
      const bytes = openBundle(recovery, id, await this.request('GET', '/' + id));
      if (bytes.toString() !== JSON.stringify(bundle)) throw new Error('Remote immutable version conflicts with local bundle'); return;
    }
    await this.request('PUT', '/' + id, sealBundle(recovery, id, Buffer.from(JSON.stringify(bundle))));
  }
  async pull(): Promise<string[]> {
    const recovery = await this.key(), references: string[] = [];
    for (const { id } of await this.list()) {
      const bundle = JSON.parse(openBundle(recovery, id, await this.request('GET', '/' + id)).toString());
      if (typeof bundle.reference !== 'string' || objectId(recovery, bundle.reference) !== id) throw new Error('Library object identity mismatch');
      references.push(await this.library.restore(bundle));
    }
    return references;
  }
  async revoke(): Promise<void> { await this.request('DELETE'); }
  async forget(): Promise<void> { await rm(join(this.root, 'recovery')); }
}
