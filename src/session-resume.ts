import { unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { parseCode } from './crypto.js';
import { Journal } from './journal.js';
import { relayUrl } from './peer.js';
import { DEFAULT_IDLE_MS } from './session-limits.js';

const record = z.object({ code: z.string(), relay: z.string(), label: z.string().max(120), lastContact: z.number().int() });
export type ResumeRecord = z.infer<typeof record>;

export class SessionResumeStore {
  private journal: Journal;
  constructor(private readonly root = join(homedir(), '.diagnose', 'session-resume')) {
    this.journal = new Journal(root, { maxAgeMs: DEFAULT_IDLE_MS, maxBytes: 1024 * 1024, maxEntries: 128 });
  }
  load(caseId: string, relay: string): ResumeRecord | undefined {
    if (!this.journal.exists(caseId)) return;
    const value = record.parse(this.journal.load(caseId).session);
    if (Date.now() - value.lastContact >= DEFAULT_IDLE_MS) { this.remove(caseId); return; }
    if (relayUrl(value.relay) !== relayUrl(relay)) throw new Error('This case has a temporary session on a different relay. Select its original relay to resume.');
    const { secret } = parseCode(value.code);
    secret.fill(0);
    return value;
  }
  save(caseId: string, session: ResumeRecord): void {
    this.journal.save({ id: caseId, kind: 'process', state: 'temporary-session', createdAt: '', updatedAt: '', ownerPid: 0, tokenHash: '', retainOnDisconnect: false, session });
  }
  remove(caseId: string): void {
    if (this.journal.exists(caseId)) unlinkSync(join(this.root, caseId + '.meta'));
  }
}
