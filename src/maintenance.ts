import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Journal, retention } from './journal.js';

export function cleanupLocal(days = 7, root = join(homedir(), '.diagnose')): unknown {
  if (!Number.isFinite(days) || days < 0) throw new Error('Cleanup days must be a nonnegative number');
  const result: Record<string, unknown> = {};
  for (const name of ['history', 'resources']) {
    const directory = join(root, name);
    if (existsSync(directory)) result[name] = new Journal(directory).cleanup({ ...retention, maxAgeMs: days * 86400000 });
  }
  result.audit = cleanupAudit(root, days * 86400000);
  return result;
}

export function cleanupAudit(root: string, maxAgeMs = retention.maxAgeMs, keep?: string): number {
  if (!existsSync(root)) return 0;
  const files = readdirSync(root).filter(name => /^audit-.*\.jsonl$/.test(name)).map(name => { const path = join(root, name), stat = statSync(path); return { path, size: stat.size, modified: stat.mtimeMs }; }).sort((a, b) => a.modified - b.modified);
  let size = files.reduce((n, file) => n + file.size, 0), removed = 0;
  for (const file of files) {
    // Active writers are never removed. New audit names include their PID.
    const pid = /-pid(\d+)-/.exec(file.path)?.[1];
    if (file.path === keep) continue;
    if (pid && !file.path.includes('-closed-')) { try { process.kill(Number(pid), 0); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; } }
    else if (Date.now() - file.modified < 60000) continue;
    if (Date.now() - file.modified >= maxAgeMs || size > 32 * 1024 * 1024) { unlinkSync(file.path); size -= file.size; removed++; }
  }
  return removed;
}
