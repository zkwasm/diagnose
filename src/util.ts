import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, openSync, closeSync, realpathSync, statSync, renameSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import os from 'node:os';
import { History } from './history.js';
import { cleanupAudit } from './maintenance.js';

export function safeText(text: string): string {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
export function redact(text: string): string {
  return safeText(text)
    .replace(/("?(?:password|passwd|pswd|secret|token|session|authorization|api[_-]?key)"?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)/gi, '$1[REDACTED]')
    .replace(/\bD1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}\b/g, '[PAIRING CODE]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[PRIVATE KEY]');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function inside(root: string, path: string): boolean {
  try { const diff = relative(realpathSync(root), realpathSync(path)); return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff)); } catch { return false; }
}

export class Audit {
  readonly path: string;
  readonly history: History;
  constructor(path = resolve(os.homedir(), '.diagnose', `audit-${Date.now()}-pid${process.pid}-${randomUUID()}.jsonl`)) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, 'ax', 0o600); closeSync(fd);
    this.history = new History(resolve(dirname(path), 'history'));
    cleanupAudit(dirname(path), undefined, path);
    this.record('session.created', {});
  }
  record(event: string, details: Record<string, unknown>): void {
    // No command text, payload, credentials, or file contents are persisted by default.
    if (statSync(this.path).size > 8 * 1024 * 1024) {
      renameSync(this.path, this.path.replace(/\.jsonl$/, '') + `-closed-${randomUUID()}.jsonl`);
      const fd = openSync(this.path, 'ax', 0o600); closeSync(fd);
      cleanupAudit(dirname(this.path), undefined, this.path);
    }
    appendFileSync(this.path, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n', { mode: 0o600, flush: true });
    if (typeof details.id === 'string') this.history.event(details.id, event, details);
  }
}
