import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { Journal } from './journal.js';
import { redact } from './util.js';

const text = z.string().min(1).max(4000);
export const targetSchema = z.object({ name: text, model: text.optional(), identity: text.optional(), interface: z.enum(['usb', 'serial', 'lan', 'host', 'other']), address: text.optional() }).strict();
export const caseInputSchema = z.object({ goal: text, target: targetSchema, host: z.string().max(120).optional(), skill: z.string().max(4096).optional() }).strict();
export const conclusionSchema = z.object({ outcome: z.enum(['resolved', 'unresolved', 'needs-physical-work', 'insufficient-evidence']), summary: text, changes: z.array(text).max(100).default([]), remaining: z.array(text).max(100).default([]), baseline: z.string().uuid().optional(), verification: z.string().uuid().optional() }).strict();
export type Evidence = { id: string; at: string; kind: string; taskId?: string; digest: string; data: unknown; truncated: boolean };
export type Case = z.infer<typeof caseInputSchema> & { id: string; createdAt: string; conclusion?: z.infer<typeof conclusionSchema>; evidence: Evidence[]; recordingLimited?: boolean };

// Structured credentials are excluded before local persistence; arbitrary output is
// still sensitive. Encryption is at rest with a same-user key, not an OS sandbox.
export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return redact(value).replace(/\bK1\.[A-Za-z0-9_-]{43}\b/g, '[LIBRARY KEY]');
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|secret|token|authorization|credential|^code$/i.test(key) ? '[REDACTED]' : sanitize(item)]));
  return value;
}
export class Cases {
  private journal: Journal;
  constructor(readonly root = join(homedir(), '.diagnose', 'cases')) { this.journal = new Journal(root); }
  create(input: z.infer<typeof caseInputSchema>): Case {
    if (this.journal.list().length >= 100) throw new Error('Case limit reached (100); export and remove old cases');
    const value = { ...caseInputSchema.parse(input), id: randomUUID(), createdAt: new Date().toISOString(), evidence: [] };
    this.save(value); return value;
  }
  get(id: string): Case { z.string().uuid().parse(id); return this.journal.load(id).case as Case; }
  save(value: Case): void {
    this.journal.save({ id: value.id, kind: 'process', state: 'case', createdAt: value.createdAt, updatedAt: '', ownerPid: 0, tokenHash: '', retainOnDisconnect: false, case: value });
  }
  list() { return this.journal.list().map(meta => { const value = meta.case as Case; return { id: value.id, goal: value.goal, target: value.target, createdAt: value.createdAt, outcome: value.conclusion?.outcome ?? 'open', evidenceCount: value.evidence.length }; }); }
  remove(id: string): void { this.get(id); if (existsSync(join(this.root, id + '.lock'))) throw new Error('Case is in use; stop its agent before removing it'); unlinkSync(join(this.root, id + '.meta')); }
  claim(id: string): () => void {
    this.get(id); const path = join(this.root, id + '.lock'), token = randomUUID();
    try { writeFileSync(path, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Case already has a writer. Stop its agent, or use diagnose cases unlock ID after an unclean exit.'); throw error; }
    return () => { try { if (JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } };
  }
  unlock(id: string): void {
    this.get(id); const path = join(this.root, id + '.lock'), lock = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new Error('Invalid case lock; inspect locally');
    let alive = true; try { process.kill(lock.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
    if (alive) throw new Error('Case writer is still alive; stop the agent first');
    unlinkSync(path);
  }
  record(id: string, kind: string, data: unknown, taskId?: string): Evidence | undefined {
    const value = this.get(id);
    if (value.evidence.length >= 200) { value.recordingLimited = true; this.save(value); return undefined; }
    const serialized = JSON.stringify(sanitize(data));
    const truncated = Buffer.byteLength(serialized) > 32768;
    const evidence: Evidence = { id: randomUUID(), at: new Date().toISOString(), kind, taskId, digest: createHash('sha256').update(serialized).digest('hex'), data: truncated ? { preview: serialized.slice(0, 8000), note: 'Evidence exceeded 32 KiB; only preview retained' } : JSON.parse(serialized), truncated };
    value.evidence.push(evidence); this.save(value); return evidence;
  }
  finish(id: string, input: z.infer<typeof conclusionSchema>): Case {
    const conclusion = conclusionSchema.parse(input), value = this.get(id);
    if (conclusion.outcome === 'resolved') {
      const baseline = value.evidence.find(item => item.id === conclusion.baseline), verification = value.evidence.find(item => item.id === conclusion.verification);
      const result = (verification?.data as { result?: { status?: string } })?.result;
      if (!baseline || baseline.kind !== 'task.result' || !verification || verification.kind !== 'task.result' || baseline.id === verification.id || value.evidence.indexOf(verification) <= value.evidence.indexOf(baseline) || verification.truncated || result?.status !== 'ok') throw new Error('Resolved requires distinct baseline and later successful verification evidence IDs from this case');
    }
    for (const reference of [conclusion.baseline, conclusion.verification]) if (reference && !value.evidence.some(item => item.id === reference)) throw new Error('Unknown case evidence ID');
    value.conclusion = sanitize(conclusion) as typeof conclusion; this.save(value); return value;
  }
  report(id: string) {
    const value = this.get(id);
    // Deliberately exclude target addresses, command arguments and result bodies.
    return { id: value.id, createdAt: value.createdAt, goal: sanitize(value.goal), target: { name: sanitize(value.target.name), model: sanitize(value.target.model), interface: value.target.interface }, skill: value.skill, conclusion: value.conclusion, recordingLimited: value.recordingLimited ?? false, evidence: value.evidence.map(({ id, at, kind, taskId, digest, truncated }) => ({ id, at, kind, taskId, digest, truncated })), note: 'Conclusion is an agent/diagnostician assessment, not an independent proof. Review free text for customer details before sharing.' };
  }
}
