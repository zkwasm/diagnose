import { randomUUID } from 'node:crypto';
import { Peer } from './peer.js';
import { MAX_OUTPUT, taskSchema, resourceRequestSchema, type TaskInput, type ResourceRequest, type Result, type WireMessage } from './schema.js';

export type Outcome = { id: string; result: Result; outputs: Record<string, string> };
export class Operator {
  private retainedBytes = 0;
  private calls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private jobs = new Map<string, { promise: Promise<Outcome>; resolve: (value: Outcome) => void; reject: (error: Error) => void; chunks: Record<string, Buffer[]>; bytes: number; index: number }>();
  constructor(readonly peer: Peer) {
    peer.on('closed', () => { for (const job of this.jobs.values()) job.reject(new Error('Session closed')); for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(new Error('Connection closed; inspect resource state before retrying input or modifications')); } this.calls.clear(); });
    peer.on('message', (message: WireMessage) => {
      if (message.type === 'resource.result') { const call = this.calls.get(message.requestId); if (call) { clearTimeout(call.timer); this.calls.delete(message.requestId); if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value); } return; }
      if (!('id' in message)) return;
      const job = this.jobs.get(message.id); if (!job) return;
      if (message.type === 'task.output') {
        const bytes = Buffer.from(message.chunk, 'base64');
        this.retainedBytes += bytes.length;
        if (message.index !== job.index++ || (job.bytes += bytes.length) > MAX_OUTPUT * 2 || this.retainedBytes > 32 * 1024 * 1024) { peer.close('Output retention limit reached; release completed results'); return; }
        (job.chunks[message.stream] ??= []).push(bytes);
      } else if (message.type === 'task.result') {
        const encodings = (message.result.data as { encodings?: Record<string, string> } | undefined)?.encodings;
        const outputs = Object.fromEntries(Object.entries(job.chunks).map(([key, chunks]) => [key, Buffer.concat(chunks).toString(encodings?.[key] === 'base64' ? 'base64' : 'utf8')]));
        job.chunks = {};
        job.resolve({ id: message.id, result: message.result, outputs });
      }
    });
  }
  async start(input: TaskInput): Promise<string> {
    if (this.jobs.size >= 1000) throw new Error('Session task limit reached');
    const normalized = input.operation === 'batch.run' && Array.isArray(input.arguments.steps) ? { ...input, arguments: { ...input.arguments, steps: input.arguments.steps.map((step: unknown) => typeof step === 'object' && step !== null && !Array.isArray(step) ? { ...step, id: (step as Record<string, unknown>).id ?? randomUUID(), reason: (step as Record<string, unknown>).reason ?? input.reason } : step) } } : input;
    const task = taskSchema.parse({ ...normalized, id: randomUUID() });
    let resolve!: (value: Outcome) => void, reject!: (error: Error) => void;
    const promise = new Promise<Outcome>((a, b) => { resolve = a; reject = b; }); promise.catch(() => {});
    this.jobs.set(task.id, { promise, resolve, reject, chunks: {}, bytes: 0, index: 0 });
    try { await this.peer.send({ type: 'task.request', task }); } catch (error) { this.jobs.delete(task.id); reject(error as Error); throw error; }
    return task.id;
  }
  async wait(id: string, timeoutMs = 1000): Promise<Outcome | { id: string; pending: true }> {
    const job = this.jobs.get(id); if (!job) throw new Error('Unknown task');
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([job.promise, new Promise<{ id: string; pending: true }>(resolve => { timer = setTimeout(() => resolve({ id, pending: true }), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async run(input: TaskInput): Promise<Outcome> { const id = await this.start(input); return this.jobs.get(id)!.promise; }
  async cancel(id: string): Promise<void> { await this.peer.send({ type: 'task.cancel', id }); }
  async resource(input: Partial<ResourceRequest> & Pick<ResourceRequest, 'action'>): Promise<unknown> {
    if (this.calls.size >= 128) throw new Error('Too many pending resource requests');
    const request = resourceRequestSchema.parse(input), requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(requestId); reject(new Error('Resource request timed out; query state before retrying writes')); }, 30000);
      this.calls.set(requestId, { resolve, reject, timer });
      void this.peer.send({ type: 'resource.request', requestId, request }).catch(error => { clearTimeout(timer); this.calls.delete(requestId); reject(error); });
    });
  }
  release(id: string): void { const job = this.jobs.get(id); if (job) this.retainedBytes -= job.bytes; this.jobs.delete(id); }
}
