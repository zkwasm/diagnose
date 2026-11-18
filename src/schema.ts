import { z } from 'zod';

export const MAX_FRAME = 64 * 1024;
export const CHUNK_SIZE = 12 * 1024;
export const MAX_OUTPUT = 10 * 1024 * 1024;
const path = z.string().min(1).max(4096);
const common = { id: z.string().uuid(), reason: z.string().min(1).max(1000) };
export const atomicOperationNames = ['system.inspect', 'system.performance', 'file.read', 'file.write', 'file.stat', 'file.list', 'file.mkdir', 'file.remove', 'file.rename', 'file.chmod', 'file.transfer', 'process.run', 'process.script', 'process.open', 'resource.resume', 'net.forward', 'serial.capture', 'serial.exchange'] as const;
export const batchOperationNames = ['system.inspect', 'system.performance', 'file.read', 'file.write', 'file.stat', 'file.list', 'file.mkdir', 'file.remove', 'file.rename', 'file.chmod', 'process.run', 'process.script', 'serial.capture', 'serial.exchange'] as const;
const environment = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(65536)).optional();
export const atomicTaskSchema = z.discriminatedUnion('operation', [
  z.object({ ...common, operation: z.literal('system.inspect'), arguments: z.object({}).strict() }).strict(),
  z.object({ ...common, operation: z.literal('system.performance'), arguments: z.object({
    limit: z.number().int().min(1).max(8).default(5), pids: z.array(z.number().int().min(1).max(0x7fffffff)).max(8).default([]),
    diskPath: path.optional(), logPaths: z.array(path).max(8).default([]),
  }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.read'), arguments: z.object({ path, offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(1024 * 1024).default(65536) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.write'), arguments: z.object({ path, content: z.string().max(1024 * 1024), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.stat'), arguments: z.object({ path }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.list'), arguments: z.object({ path, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.mkdir'), arguments: z.object({ path, recursive: z.boolean().default(false) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.remove'), arguments: z.object({ path, recursive: z.boolean().default(false) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.rename'), arguments: z.object({ path, destination: path, overwrite: z.boolean().default(false) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.chmod'), arguments: z.object({ path, mode: z.number().int().min(0).max(0o777) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('file.transfer'), arguments: z.object({ path, direction: z.enum(['upload', 'download']), size: z.number().int().min(0).max(1024 ** 4).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), overwrite: z.boolean().default(false), retainOnDisconnect: z.boolean().default(true) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('process.open'), arguments: z.object({ executable: path.optional(), args: z.array(z.string().max(65536)).max(128).default([]), cwd: path.optional(), env: environment, pty: z.boolean().default(false), cols: z.number().int().min(20).max(500).default(100), rows: z.number().int().min(5).max(200).default(30), timeoutMs: z.number().int().min(0).max(86400000).default(3600000), retainOnDisconnect: z.boolean().default(false), maxOutputBytes: z.number().int().min(1024).max(1024 ** 3).default(64 * 1024 ** 2) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('resource.resume'), arguments: z.object({ id: z.string().uuid(), resumeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('net.forward'), arguments: z.object({ direction: z.enum(['local', 'remote', 'socks']), host: z.string().min(1).max(253).default('127.0.0.1'), port: z.number().int().min(0).max(65535).default(0), bindHost: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'), bindPort: z.number().int().min(0).max(65535).default(0), allowedHosts: z.array(z.string().min(1).max(253)).min(1).max(100).default(['*']) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('process.run'), arguments: z.object({ executable: path, args: z.array(z.string().max(65536)).max(128).default([]), cwd: path.optional(), timeoutMs: z.number().int().min(100).max(300000).default(60000) }).strict() }).strict(),
  z.object({ ...common, operation: z.literal('process.script'), arguments: z.object({ interpreter: path, script: z.string().min(1).max(256 * 1024), args: z.array(z.string().max(65536)).max(128).default([]), cwd: path.optional(), timeoutMs: z.number().int().min(100).max(300000).default(60000) }).strict() }).strict(),
  ...(['serial.capture', 'serial.exchange'] as const).map(operation => z.object({ ...common, operation: z.literal(operation), arguments: z.object({ path, baudRate: z.number().int().min(300).max(3000000).default(115200), durationMs: z.number().int().min(100).max(300000).default(20000), dataHex: z.string().regex(/^(?:[a-fA-F0-9]{2})*$/).max(65536).optional() }).strict() }).strict()),
]);
export const batchTaskSchema = z.object({ ...common, operation: z.literal('batch.run'), arguments: z.object({ steps: z.array(atomicTaskSchema).min(1).max(32), stopOnError: z.boolean().default(true), timeoutMs: z.number().int().min(100).max(300000).default(300000) }).strict() }).strict().refine(task => new Set([task.id, ...task.arguments.steps.map(step => step.id)]).size === task.arguments.steps.length + 1, 'Batch task IDs must be unique');
export const taskSchema = z.union([atomicTaskSchema, batchTaskSchema]);
export type AtomicTask = z.infer<typeof atomicTaskSchema>;
export type BatchTask = z.infer<typeof batchTaskSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskInput = { operation: Task['operation']; arguments: Record<string, unknown>; reason: string };
export type ApprovalStage = 'execute' | 'send';
export type Approval = { stage: ApprovalStage; task: Task; digest: string; preview: string; bytes?: number; signal?: AbortSignal };
export type ApprovalHandler = (request: Approval) => Promise<boolean>;
export type Result = { status: 'ok' | 'error' | 'denied' | 'cancelled' | 'duplicate'; data?: unknown; error?: string; exitCode?: number | null; truncated?: boolean };
export const resourceRequestSchema = z.object({ id: z.string().uuid().optional(), action: z.enum(['list', 'read', 'input', 'resize', 'signal', 'status', 'close', 'commit', 'connect', 'accept']), cursor: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(65536).default(65536), data: z.string().max(90000).optional(), eof: z.boolean().default(false), cols: z.number().int().min(20).max(500).optional(), rows: z.number().int().min(5).max(200).optional(), signal: z.enum(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGQUIT']).optional(), host: z.string().min(1).max(253).optional(), port: z.number().int().min(1).max(65535).optional() }).strict();
export type ResourceRequest = z.infer<typeof resourceRequestSchema>;
export type WireMessage =
  | { type: 'session.accepted'; label: string; fingerprint: string; credential?: string }
  | { type: 'session.closed'; reason: string }
  | { type: 'task.request'; task: Task; sequence?: number }
  | { type: 'task.started'; id: string; digest: string }
  | { type: 'task.output'; id: string; stream: string; chunk: string; index: number }
  | { type: 'task.result'; id: string; result: Result }
  | { type: 'task.cancel'; id: string }
  | { type: 'resource.request'; requestId: string; request: ResourceRequest }
  | { type: 'resource.result'; requestId: string; value?: unknown; error?: string }
  | { type: 'resource.request'; requestId: string; request: ResourceRequest }
  | { type: 'resource.result'; requestId: string; value?: unknown; error?: string }
  | { type: 'ping'; activity?: true }
  | { type: 'pong' };

export function parseMessage(value: unknown): WireMessage {
  const basic = z.object({ type: z.string() }).passthrough().parse(value);
  switch (basic.type) {
    case 'task.request': return { type: basic.type, task: taskSchema.parse(basic.task), ...(basic.sequence === undefined ? {} : { sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(basic.sequence) }) };
    case 'task.cancel': return { type: basic.type, id: z.string().uuid().parse(basic.id) };
    case 'resource.request': return { type: basic.type, requestId: z.string().uuid().parse(basic.requestId), request: resourceRequestSchema.parse(basic.request) };
    case 'resource.result': return z.object({ type: z.literal('resource.result'), requestId: z.string().uuid(), value: z.unknown().optional(), error: z.string().max(2000).optional() }).strict().parse(value);
    case 'ping': return basic.activity === true ? { type: 'ping', activity: true } : { type: 'ping' };
    case 'pong': return { type: 'pong' };
    case 'session.accepted': return z.object({ type: z.literal('session.accepted'), label: z.string().max(120), fingerprint: z.string().max(100), credential: z.string().regex(/^D1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/).optional() }).strict().parse(value);
    case 'session.closed': return z.object({ type: z.literal('session.closed'), reason: z.string().max(200) }).strict().parse(value);
    case 'task.started': return z.object({ type: z.literal('task.started'), id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value);
    case 'task.output': return z.object({ type: z.literal('task.output'), id: z.string().uuid(), stream: z.string().max(20), chunk: z.string().max(CHUNK_SIZE * 2), index: z.number().int().min(0) }).strict().parse(value);
    case 'task.result': return z.object({ type: z.literal('task.result'), id: z.string().uuid(), result: z.object({ status: z.enum(['ok', 'error', 'denied', 'cancelled', 'duplicate']), data: z.unknown().optional(), error: z.string().max(2000).optional(), exitCode: z.number().int().nullable().optional(), truncated: z.boolean().optional() }).strict() }).strict().parse(value);
    default: throw new Error('Unsupported message type');
  }
}
