import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Journal, retention } from './journal.js';
import type { Task } from './schema.js';
import type { Execution } from './executor.js';

// Local-only evidence. Never exposed as a remote MCP tool. Exact task contents
// may contain secrets; payloads are encrypted and expire under a bounded budget.
export class History {
  readonly journal: Journal;
  constructor(root = join(homedir(), '.diagnose', 'history')) { this.journal = new Journal(root, retention); }
  begin(task: Task): void {
    const now = new Date().toISOString();
    const request = task.operation === 'resource.resume' ? { ...task, arguments: { ...task.arguments, resumeToken: '[RECOVERY CREDENTIAL OMITTED]' } } : task;
    this.journal.save({ id: task.id, kind: 'process', state: 'running', createdAt: now, updatedAt: now, ownerPid: process.pid, tokenHash: '', retainOnDisconnect: false, operation: task.operation, reason: task.reason, request });
  }
  event(id: string, event: string, details: unknown): void {
    if (!this.journal.exists(id)) return;
    this.journal.append(id, 'events', Buffer.from(JSON.stringify({ at: new Date().toISOString(), event, details }) + '\n'));
  }
  collected(id: string, execution: Execution): void {
    const result = structuredClone(execution.result);
    if (result.data && typeof result.data === 'object') delete (result.data as Record<string, unknown>).resumeToken;
    this.event(id, 'collected', { result, streams: execution.outputs.map(({ stream, encoding }) => ({ stream, encoding })) });
    for (const output of execution.outputs) this.journal.append(id, output.stream, output.bytes);
  }
  finish(id: string): void { if (this.journal.exists(id)) { const meta = this.journal.load(id); meta.state = 'completed'; this.journal.save(meta); } }
  list(): unknown[] { return this.journal.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ id, createdAt, operation, reason, state }) => ({ id, createdAt, operation, reason, state })); }
  show(id: string, resourceCursor = 0): unknown {
    const resourceRoot = join(dirname(this.journal.root), 'resources');
    const resources = existsSync(resourceRoot) ? new Journal(resourceRoot) : undefined;
    const resource = resources?.exists(id) ? resources.load(id) : undefined;
    const meta = this.journal.exists(id) ? this.journal.load(id) : resource;
    if (!meta) throw new Error('Unknown or expired history ID');
    const streams: Record<string, Buffer[]> = {}; let cursor = 0;
    while (true) { const page = this.journal.read(id, cursor); for (const record of page.records) (streams[record.stream] ??= []).push(Buffer.from(record.data, 'base64')); cursor = page.cursor; if (!page.hasMore) break; }
    const events = Buffer.concat(streams.events ?? []).toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); delete streams.events;
    const collected = events.find(item => item.event === 'collected');
    return { id, createdAt: meta.createdAt, state: meta.state, request: meta.request, events, ...(resource?.kind === 'process' ? { resourceOutput: resources!.read(id, resourceCursor) } : {}), outputs: Object.fromEntries(Object.entries(streams).map(([name, chunks]) => { const encoding = collected?.details.streams.find((stream: { stream: string }) => stream.stream === name)?.encoding ?? 'base64'; return [name, { encoding, data: Buffer.concat(chunks).toString(encoding === 'utf8' ? 'utf8' : 'base64') }]; })) };
  }
}
