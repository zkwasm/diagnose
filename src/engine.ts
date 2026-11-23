import { Peer } from './peer.js';
import { execute, prepareWrite, type Execution } from './executor.js';
import { CHUNK_SIZE, MAX_OUTPUT, type Approval, type ApprovalHandler, type AtomicTask, type BatchTask, type Result, type Task, type WireMessage } from './schema.js';
import { Audit, digest, redact, safeText } from './util.js';
import { SessionResources, resourceOperation } from './resources.js';
import { randomUUID } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { DEFAULT_IDLE_MS } from './session-limits.js';

export type PermissionMode = 'ask' | 'auto';
function aborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => reject(new Error('Task cancelled'));
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

export class ProbeEngine {
  private jobs = new Map<string, AbortController>();
  private seen = new Set<string>();
  private sequence = 0;
  private sequenced?: boolean;
  private idle?: NodeJS.Timeout;
  private lifetime?: NodeJS.Timeout;
  private ended = false;
  private mode: PermissionMode = 'ask';
  private owner = randomUUID();
  readonly resources: SessionResources;
  private approvalQueue: Promise<void> = Promise.resolve();
  get permissionMode(): PermissionMode { return this.mode; }
  // Local API only. No wire message or task argument can change permission mode.
  setPermissionMode(mode: PermissionMode): void {
    if (!['ask', 'auto'].includes(mode)) throw new Error('Invalid permission mode');
    if (mode === this.mode) return;
    this.audit.record('permissions.changed', { from: this.mode, to: mode, automaticExecution: mode === 'auto', automaticTransfer: mode === 'auto' });
    this.mode = mode;
    if (mode === 'ask') this.cancelAll();
    if (mode === 'ask') void this.resources.revoke().catch(() => this.peer.close('Resource cleanup failed'));
    this.notice(`Permission mode: ${mode}${mode === 'auto' ? ' (automatic execution AND transmission)' : ' (active work cancelled; approval required)'}`);
  }
  cancelAll(): void {
    for (const [id, controller] of this.jobs) { this.audit.record('task.cancel-requested', { id, source: 'local' }); controller.abort(); }
    void this.resources.revoke(this.owner).catch(() => this.peer.close('Resource cleanup failed'));
  }
  constructor(private peer: Peer, private approve: ApprovalHandler, readonly audit: Audit, private notice: (message: string) => void = () => {}, options: { resources?: SessionResources; idleMs?: number; lifetimeMs?: number } = {}) {
    this.resources = options.resources ?? new SessionResources(join(dirname(audit.path), basename(audit.path) + '.resources'), audit);
    this.resources.setAudit(audit);
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    const refreshIdle = () => {
      if (!idleMs || this.ended) return;
      clearTimeout(this.idle);
      this.idle = setTimeout(() => peer.close('Idle timeout'), idleMs);
    };
    // Waiting for an invitation/approval is not diagnostic session time.
    void peer.active.then(() => {
      if (this.ended) return;
      refreshIdle();
      if (options.lifetimeMs) this.lifetime = setTimeout(() => peer.close('Session lifetime exceeded'), options.lifetimeMs);
    }).catch(() => {});
    peer.on('activity', refreshIdle);
    peer.on('message', (message: WireMessage) => {
      refreshIdle();
      if (message.type === 'resource.request') { void this.resources.control(this.owner, message.request).then(value => this.peer.send({ type: 'resource.result', requestId: message.requestId, value }), error => this.peer.send({ type: 'resource.result', requestId: message.requestId, error: redact((error as Error).message).slice(0, 2000) })).catch(() => {}); return; }
      if (message.type === 'task.cancel') { try { audit.record('task.cancel-requested', { id: message.id, source: 'operator' }); this.jobs.get(message.id)?.abort(); void this.resources.control(this.owner, { id: message.id, action: 'close', cursor: 0, limit: 65536, eof: false }).catch(() => {}); } catch { peer.close('Audit unavailable'); } return; }
      if (message.type !== 'task.request') { peer.close('Unexpected operator message'); return; }
      const task = message.task;
      this.sequenced ??= message.sequence !== undefined;
      if (this.sequenced !== (message.sequence !== undefined)) { peer.close('Task sequence mode cannot change'); return; }
      if (message.sequence !== undefined) {
        if (message.sequence <= this.sequence) { void this.reply(task.id, { status: 'duplicate' }); return; }
        this.sequence = message.sequence;
      } else {
        if (this.seen.has(task.id)) { void this.reply(task.id, { status: 'duplicate' }); return; }
        if (this.seen.size >= 1000) { void this.reply(task.id, { status: 'error', error: 'Legacy client task limit: reconnect and update both endpoints to 0.5.0+. This request was not executed.' }); return; }
        this.seen.add(task.id);
      }
      if (this.jobs.has(task.id)) { void this.reply(task.id, { status: 'duplicate' }); return; }
      if (this.jobs.size >= 4) { void this.reply(task.id, { status: 'error', error: 'Four tasks are active; wait for completion before submitting new work' }); return; }
      const controller = new AbortController(); this.jobs.set(task.id, controller);
      void this.run(task, controller);
    });
    peer.on('closed', (reason?: string) => { this.ended = true; clearTimeout(this.idle); clearTimeout(this.lifetime); for (const controller of this.jobs.values()) controller.abort(); void this.resources.disconnect(this.owner).catch(() => {}); try { audit.record('session.closed', { reason: reason && redact(reason) }); } catch { /* Session is already closed. */ } });
  }
  private async reply(id: string, result: Result): Promise<void> { await this.peer.send({ type: 'task.result', id, result }).catch(() => {}); }
  private async finish(id: string, result: Result): Promise<void> { this.jobs.delete(id); await this.reply(id, result); }
  private permission(request: Approval): Promise<boolean> {
    const result = this.approvalQueue.then(() => this.decidePermission(request));
    this.approvalQueue = result.then(() => {}, () => {}); return result;
  }
  private async decidePermission(request: Approval): Promise<boolean> {
    request.signal!.throwIfAborted();
    this.audit.history.event(request.task.id, 'approval-preview', { stage: request.stage, digest: request.digest, preview: request.preview });
    if (this.mode === 'auto') {
      this.audit.record('task.auto-approved', { id: request.task.id, stage: request.stage, digest: request.digest, ...(request.bytes === undefined ? {} : { bytes: request.bytes }) });
      this.notice(`[AUTO ${request.stage}] ${request.task.operation}`);
      return true;
    }
    return aborted(this.approve(request), request.signal!);
  }
  private recordRequest(task: AtomicTask, parentId?: string): void {
    const target = 'path' in task.arguments ? task.arguments.path : 'executable' in task.arguments ? task.arguments.executable : 'interpreter' in task.arguments ? task.arguments.interpreter : undefined;
    const scope = task.operation === 'file.read' ? { offset: task.arguments.offset, length: task.arguments.length }
      : task.operation === 'serial.capture' || task.operation === 'serial.exchange' ? { baudRate: task.arguments.baudRate, durationMs: task.arguments.durationMs }
      : task.operation === 'process.run' || task.operation === 'process.script' ? { cwd: task.arguments.cwd ?? process.cwd(), argumentCount: task.arguments.args.length, timeoutMs: task.arguments.timeoutMs, ...(task.operation === 'process.script' ? { scriptBytes: Buffer.byteLength(task.arguments.script) } : {}) } : {};
    this.audit.record('task.requested', { id: task.id, operation: task.operation, digest: digest(task), ...(parentId ? { parentId } : {}), ...(target ? { target } : {}), ...scope });
  }
  private async runAtomic(task: AtomicTask, signal: AbortSignal, write: ReturnType<typeof prepareWrite>, parentId?: string): Promise<Execution> {
    signal.throwIfAborted();
    this.audit.record('task.executing', { id: task.id, ...(parentId ? { parentId } : {}) });
    const execution: Execution = resourceOperation(task.operation) ? { result: { status: 'ok', data: await this.resources.open(task, this.owner, signal) }, outputs: [] } : await execute(task, signal, write);
    if (execution.outputs.some(item => item.truncated)) execution.result.truncated = true;
    if (task.operation === 'file.write' && execution.result.status === 'ok') this.audit.record('task.file-changed', { id: task.id, ...(parentId ? { parentId } : {}), ...(execution.result.data as Record<string, unknown>) });
    if (['file.mkdir', 'file.remove', 'file.rename', 'file.chmod'].includes(task.operation) && execution.result.status === 'ok') this.audit.record('task.filesystem-changed', { id: task.id, operation: task.operation, ...(parentId ? { parentId } : {}), ...task.arguments });
    this.audit.record('task.collected', { id: task.id, ...(parentId ? { parentId } : {}), bytes: execution.outputs.reduce((n, item) => n + item.bytes.length, 0), status: execution.result.status, streams: execution.outputs.map(item => ({ stream: item.stream, bytes: item.bytes.length, encoding: item.encoding })) });
    return execution;
  }
  private async runBatch(task: BatchTask, parentSignal: AbortSignal, writes: Map<string, ReturnType<typeof prepareWrite>>, hash: string): Promise<Execution> {
    const controller = new AbortController(); const abort = (): void => controller.abort();
    parentSignal.addEventListener('abort', abort, { once: true }); if (parentSignal.aborted) abort();
    let timedOut = false, total = 0, truncated = false, outputLimit = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, task.arguments.timeoutMs);
    const outputs: Execution['outputs'] = [], results: { id: string; operation: AtomicTask['operation']; result: Result; streams: string[] }[] = [];
    try {
      for (const [index, step] of task.arguments.steps.entries()) {
        if (controller.signal.aborted) break;
        if (total >= MAX_OUTPUT) { truncated = true; break; }
        if (digest(task) !== hash) throw new Error('Batch parameters changed after approval');
        let execution: Execution;
        try { execution = await this.runAtomic(step, controller.signal, writes.get(step.id), task.id); }
        catch (error) {
          execution = { result: { status: controller.signal.aborted ? 'cancelled' : 'error', error: redact((error as Error).message).slice(0, 2000) }, outputs: [] };
          this.audit.record('task.failed', { id: step.id, parentId: task.id, status: execution.result.status });
        }
        if (timedOut) execution.result = { ...execution.result, status: 'error', error: 'Batch timeout' };
        const streams: string[] = [];
        for (const item of execution.outputs) {
          const keep = Math.max(0, Math.min(item.bytes.length, MAX_OUTPUT - total));
          if (keep < item.bytes.length) { truncated = true; outputLimit = true; execution.result.truncated = true; }
          const stream = `${index}.${item.stream}`; streams.push(stream);
          if (keep) outputs.push({ ...item, stream, bytes: item.bytes.subarray(0, keep) });
          total += keep;
        }
        truncated ||= execution.result.truncated === true;
        results.push({ id: step.id, operation: step.operation, result: execution.result, streams });
        this.audit.record('task.step-completed', { id: step.id, parentId: task.id, index, status: execution.result.status });
        if (timedOut || outputLimit || (task.arguments.stopOnError && execution.result.status !== 'ok')) break;
      }
      parentSignal.throwIfAborted();
      if (timedOut) this.audit.record('task.batch-timeout', { id: task.id, completedSteps: results.length });
      const stoppedEarly = results.length < task.arguments.steps.length;
      return { result: { status: !timedOut && !stoppedEarly && !outputLimit && results.every(item => item.result.status === 'ok') ? 'ok' : 'error', truncated, ...(timedOut ? { error: 'Batch timeout' } : {}), data: { steps: results, totalSteps: task.arguments.steps.length, completedSteps: results.length, stoppedEarly } }, outputs };
    } finally { clearTimeout(timer); parentSignal.removeEventListener('abort', abort); }
  }
  private async run(task: Task, controller: AbortController): Promise<void> {
    const { signal } = controller; const hash = digest(task);
    try {
      this.audit.history.begin(task);
      const steps = task.operation === 'batch.run' ? task.arguments.steps : [task];
      if (task.operation === 'batch.run' && steps.some(step => resourceOperation(step.operation))) throw new Error('Open interactive/transfer/forward resources separately; their subsequent actions share one approved scope');
      if (task.operation === 'batch.run') this.audit.record('task.requested', { id: task.id, operation: task.operation, digest: hash, steps: steps.length });
      for (const step of steps) this.recordRequest(step, task.operation === 'batch.run' ? task.id : undefined);
      const writes = new Map(steps.map(step => [step.id, prepareWrite(step)]));
      const details = steps.map((step, index) => `${writes.get(step.id) ? `\nStep ${index + 1} write preview:\n${writes.get(step.id)!.preview}` : ''}${step.operation === 'process.script' ? `\nStep ${index + 1} complete script (${step.arguments.interpreter}):\n${step.arguments.script}\n--- end script ---` : ''}`).join('');
      const preview = safeText(JSON.stringify(task, null, 2) + details) + (steps.some(step => step.operation.startsWith('serial.')) ? '\nSerial control lines may reset the device.' : '');
      if (!await this.permission({ stage: 'execute', task, digest: hash, preview, signal })) { this.audit.record('task.denied', { id: task.id }); await this.finish(task.id, { status: 'denied' }); return; }
      signal.throwIfAborted(); if (digest(task) !== hash) throw new Error('Task parameters changed after approval');
      const continuous = resourceOperation(task.operation);
      if (continuous && !await this.permission({ stage: 'send', task, digest: hash, preview: `${preview}\nThis grants continuing raw bidirectional input/output, file bytes or tunnel traffic for this resource. No automatic redaction. Further input/actions within the approved handle do not prompt again. retainOnDisconnect keeps the resource alive while this host CLI remains running.`, signal })) { await this.finish(task.id, { status: 'denied' }); return; }
      signal.throwIfAborted(); if (digest(task) !== hash) throw new Error('Task parameters changed after approval');
      this.audit.record('task.approved', { id: task.id, digest: hash, mode: this.mode });
      await this.peer.send({ type: 'task.started', id: task.id, digest: hash });
      const execution = task.operation === 'batch.run' ? await this.runBatch(task, signal, writes, hash) : await this.runAtomic(task, signal, writes.get(task.id));
      this.audit.history.collected(task.id, execution);
      const count = execution.outputs.reduce((sum, item) => sum + item.bytes.length, 0);
      if (task.operation === 'batch.run') this.audit.record('task.collected', { id: task.id, bytes: count, status: execution.result.status });
      signal.throwIfAborted();
      const outputPreview = execution.outputs.map(item => `[${item.stream}/${item.encoding}; ${item.bytes.length} bytes]\n${item.encoding === 'utf8' ? item.bytes.toString('utf8') : `BINARY: no automatic redaction. Preview shows first 256 bytes; approval sends all ${item.bytes.length} bytes.\n${item.bytes.subarray(0, 256).toString('hex')}`}`).join('\n');
      if (!continuous && !await this.permission({ stage: 'send', task, digest: hash, preview: JSON.stringify(execution.result) + '\n' + outputPreview, bytes: count, signal })) { this.audit.record('task.send-denied', { id: task.id }); await this.finish(task.id, { status: 'denied', error: 'Collected locally; user declined transfer' }); return; }
      signal.throwIfAborted(); this.audit.record('task.transfer-approved', { id: task.id, bytes: count, mode: this.mode });
      await this.transfer(task.id, execution, signal);
      this.audit.record('task.completed', { id: task.id, status: execution.result.status });
    } catch (error) {
      const status = signal.aborted ? 'cancelled' : 'error';
      if (signal.aborted && task.operation !== 'batch.run' && resourceOperation(task.operation)) await this.resources.abandon(task, this.owner).catch(() => {});
      try { this.audit.record('task.failed', { id: task.id, status }); } catch { this.peer.close('Audit unavailable'); }
      await this.finish(task.id, { status, error: signal.aborted ? 'Cancelled' : redact((error as Error).message).slice(0, 2000) });
    } finally { this.jobs.delete(task.id); try { this.audit.history.finish(task.id); } catch { this.peer.close('Local history unavailable'); } }
  }
  private async transfer(id: string, execution: Execution, signal: AbortSignal): Promise<void> {
    let index = 0; const encodings: Record<string, string> = {};
    for (const item of execution.outputs) {
      encodings[item.stream] = item.encoding;
      for (let offset = 0; offset < item.bytes.length; offset += CHUNK_SIZE) {
        signal.throwIfAborted(); const chunk = item.bytes.subarray(offset, offset + CHUNK_SIZE);
        this.audit.record('task.chunk-sending', { id, index, bytes: chunk.length });
        await this.peer.send({ type: 'task.output', id, stream: item.stream, chunk: chunk.toString('base64'), index: index++ });
      }
    }
    signal.throwIfAborted(); this.jobs.delete(id);
    await this.peer.send({ type: 'task.result', id, result: { ...execution.result, data: { ...(execution.result.data as object ?? {}), encodings } } });
  }
}
