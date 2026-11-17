import { randomUUID } from 'node:crypto';
import { readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Journal } from './journal.js';
import { parseCode } from './crypto.js';
import { Peer, relayUrl } from './peer.js';
import { Operator } from './operator.js';
const recordSchema = z.object({ id: z.string().uuid(), role: z.enum(['host', 'operator']), name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/), label: z.string().max(120), relay: z.string(), code: z.string(), autoUntil: z.number().int().min(0).nullable(), paused: z.boolean() });
export type Pairing = z.infer<typeof recordSchema>;
// A separate random capability per relationship, exchanged only inside the
// approved Noise channel. Never reuse or retain the invitation credential.
export class PairingStore {
  private journal: Journal;
  constructor(readonly root = join(homedir(), '.diagnose', 'pairings')) { this.journal = new Journal(root); }
  list(role?: Pairing['role']): Pairing[] {
    return readdirSync(this.root).filter(name => /^[a-f0-9-]{36}\.meta$/.test(name)).map(name => {
      const value = recordSchema.parse(this.journal.load(name.slice(0, -5)).pairing); parseCode(value.code); relayUrl(value.relay); return value;
    }).filter(value => !role || value.role === role);
  }
  save(value: Pairing): void {
    recordSchema.parse(value); parseCode(value.code); relayUrl(value.relay);
    if (this.list(value.role).some(other => other.name === value.name && other.id !== value.id)) throw new Error('Device name already exists; choose another name or forget it locally');
    this.journal.save({ id: value.id, kind: 'process', state: 'paired', createdAt: new Date().toISOString(), updatedAt: '', ownerPid: 0, tokenHash: '', retainOnDisconnect: false, pairing: value });
  }
  add(value: Omit<Pairing, 'id' | 'autoUntil' | 'paused'>): Pairing { const pairing = { ...value, id: randomUUID(), autoUntil: 0, paused: false }; this.save(pairing); return pairing; }
  get(name: string, role: Pairing['role']): Pairing { const value = this.list(role).find(value => value.name === name || value.id === name); if (!value) throw new Error('Unknown paired device'); return value; }
  remove(id: string): void { const value = this.list().find(value => value.id === id); if (!value) throw new Error('Unknown pairing'); unlinkSync(join(this.root, value.id + '.meta')); }
}
export function automatic(pairing: Pairing, now = Date.now()): boolean { return !pairing.paused && (pairing.autoUntil === null || pairing.autoUntil > now); }

// Reconnect only before a NEW request. An interrupted Operator is never reused,
// and no sent task/input/write is retried. Recovery uses explicit resource IDs.
export class RememberedConnection {
  private operator?: Operator;
  private opening?: Promise<Operator>;
  private stopped = false;
  private candidate?: Peer;
  constructor(private pairing: Pairing, private timeoutMs = 30000) {}
  async connect(): Promise<Operator> {
    if (this.stopped) throw new Error('Connection ended');
    if (this.operator) return this.operator;
    return this.opening ??= this.open().finally(() => { this.opening = undefined; });
  }
  private async open(): Promise<Operator> {
    const deadline = Date.now() + this.timeoutMs;
    while (!this.stopped) {
      const peer = new Peer({ role: 'join', code: this.pairing.code, relay: this.pairing.relay, label: this.pairing.label, approvalTimeoutMs: Math.max(1, deadline - Date.now()) }); this.candidate = peer;
      const timer = setTimeout(() => peer.close('Paired device unavailable'), Math.max(1, deadline - Date.now()));
      try {
        await peer.open(); if (this.stopped) throw new Error('Connection ended');
        const operator = new Operator(peer); this.operator = operator;
        peer.once('closed', () => { if (this.operator === operator) this.operator = undefined; });
        return operator;
      } catch (error) {
        peer.close(); if (this.stopped || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(300, Math.max(1, deadline - Date.now()))));
      } finally { clearTimeout(timer); }
    }
    throw new Error('Connection ended');
  }
  close(): void { this.stopped = true; this.candidate?.close(); this.operator?.peer.close(); }
}
