import { randomUUID } from 'node:crypto';
import { Peer } from './peer.js';
import { MAX_OUTPUT, taskSchema, resourceRequestSchema, type TaskInput, type ResourceRequest, type Result, type TaskPhase, type WireMessage } from './schema.js';

export type Outcome = { id: string; result: Result; outputs: Record<string, string> };
type Pending = { id: string; pending: true; stage: 'awaiting-start' | 'started' | TaskPhase };
export class Operator {
  observe?: (kind: string, data: unknown, taskId?: string) => void;
  private observed(kind: string, data: unknown, taskId?: string): void {
    try { this.observe?.(kind, data, taskId); } catch { console.error('Case evidence could not be saved. Inspect local storage before relying on the case report.'); }
  }
  private retainedBytes = 0;
  private sequence = 0;
  private calls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private jobs = new Map<string, { promise: Promise<Outcome>; resolve: (value: Outcome) => void; reject: (error: Error) => void; chunks: Record<string, Buffer[]>; bytes: number; index: number; complete: boolean; stage: Pending['stage'] }>();
  constructor(readonly peer: Peer) {
    peer.on('closed', () => { this.observed('connection.closed', { warning: 'Interrupted modifications are not replayed. Inspect state before retrying.' }); for (const job of this.jobs.values()) job.reject(new Error('Session closed')); for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(new Error('Connection closed; inspect resource state before retrying input or modifications')); } this.calls.clear(); });
    peer.on('message', (message: WireMessage) => {
      if (message.type === 'resource.result') { const call = this.calls.get(message.requestId); if (call) { clearTimeout(call.timer); this.calls.delete(message.requestId); if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value); } return; }
      if (!('id' in message)) return;
      const job = this.jobs.get(message.id); if (!job) return;
      if (message.type === 'task.started') {
        job.stage = 'started';
      } else if (message.type === 'task.progress') {
        job.stage = message.phase;
      } else if (message.type === 'task.output') {
        const bytes = Buffer.from(message.chunk, 'base64');
        this.retainedBytes += bytes.length;
        this.trimResults(32 * 1024 * 1024);
        if (message.index !== job.index++ || (job.bytes += bytes.length) > MAX_OUTPUT * 2 || this.retainedBytes > 32 * 1024 * 1024) { peer.close('Output retention limit reached; release completed results'); return; }
        (job.chunks[message.stream] ??= []).push(bytes);
      } else if (message.type === 'task.result') {
        const encodings = (message.result.data as { encodings?: Record<string, string> } | undefined)?.encodings;
        const outputs = Object.fromEntries(Object.entries(job.chunks).map(([key, chunks]) => [key, Buffer.concat(chunks).toString(encodings?.[key] === 'base64' ? 'base64' : 'utf8')]));
        job.chunks = {}; job.complete = true;
        const outcome = { id: message.id, result: message.result, outputs };
        this.observed('task.result', outcome, message.id); job.resolve(outcome);
      }
    });
  }
  async start(input: TaskInput, id: string = randomUUID()): Promise<string> {
    this.trimResults(24 * 1024 * 1024, 128);
    if (this.jobs.size >= 128) throw new Error('Too many pending tasks; wait for completion');
    const normalized = input.operation === 'batch.run' && Array.isArray(input.arguments.steps) ? { ...input, arguments: { ...input.arguments, steps: input.arguments.steps.map((step: unknown) => typeof step === 'object' && step !== null && !Array.isArray(step) ? { ...step, id: (step as Record<string, unknown>).id ?? randomUUID(), reason: (step as Record<string, unknown>).reason ?? input.reason } : step) } } : input;
    const task = taskSchema.parse({ ...normalized, id });
    const steps = task.operation === 'batch.run' ? task.arguments.steps : [task];
    if (!this.peer.supportsPerformance && steps.some(step => step.operation === 'system.performance')) {
      throw new Error('The on-site probe does not support system.performance. Update it before requesting this operation.');
    }
    if (steps.some(step => (step.operation === 'serial.capture' || step.operation === 'serial.exchange') && step.arguments.reattach
      && (!this.peer.supportsSerialReattach || step.operation !== 'serial.capture'))) {
      throw new Error('USB reattachment requires a supported on-site probe and a read-only serial.capture task.');
    }
    if (this.jobs.has(id)) throw new Error('This task ID is already in use');
    this.observed('task.request', task, task.id);
    let resolve!: (value: Outcome) => void, reject!: (error: Error) => void;
    const promise = new Promise<Outcome>((a, b) => { resolve = a; reject = b; }); promise.catch(() => {});
    this.jobs.set(task.id, { promise, resolve, reject, chunks: {}, bytes: 0, index: 0, complete: false, stage: 'awaiting-start' });
    try { await this.peer.send({ type: 'task.request', task, sequence: ++this.sequence }); } catch (error) { this.jobs.delete(task.id); reject(error as Error); throw error; }
    return task.id;
  }
  async wait(id: string, timeoutMs = 1000): Promise<Outcome | Pending> {
    const job = this.jobs.get(id); if (!job) throw new Error('Unknown or expired task result; completed results are bounded to 128 tasks / 32 MiB. Do not replay modifications; inspect remote state or local history.');
    // Polling a real task is diagnostic activity even though the result is cached locally.
    void this.peer.send({ type: 'ping', activity: true }).catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([job.promise, new Promise<Pending>(resolve => { timer = setTimeout(() => resolve({ id, pending: true, stage: job.stage }), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async run(input: TaskInput): Promise<Outcome> { const id = await this.start(input); return this.jobs.get(id)!.promise; }
  async cancel(id: string): Promise<void> { await this.peer.send({ type: 'task.cancel', id }); }
  async resource(input: Partial<ResourceRequest> & Pick<ResourceRequest, 'action'>): Promise<unknown> {
    if (this.calls.size >= 128) throw new Error('Too many pending resource requests');
    const request = resourceRequestSchema.parse(input), requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(requestId); reject(new Error('Resource request timed out; query state before retrying writes')); }, 30000);
      this.observed('resource.request', request);
      this.calls.set(requestId, { resolve: value => { this.observed('resource.result', value); resolve(value); }, reject, timer });
      void this.peer.send({ type: 'resource.request', requestId, request }).catch(error => { clearTimeout(timer); this.calls.delete(requestId); reject(error); });
    });
  }
  private trimResults(maxBytes: number, maxCount = Infinity): void {
    for (const [id, job] of this.jobs) {
      if (this.retainedBytes <= maxBytes && this.jobs.size < maxCount) break;
      if (job.complete) this.release(id);
    }
  }
  release(id: string): void { const job = this.jobs.get(id); if (job) this.retainedBytes -= job.bytes; this.jobs.delete(id); }
}
