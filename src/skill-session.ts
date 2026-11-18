import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pairingProgress, relayUrl } from './peer.js';
import { DEFAULT_IDLE_MS } from './session-limits.js';

const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
const loopback = '127.0.0.1';
const defaultRelay = 'https://diagnose.fenginwind.com';
const requestMs = 135_000;
const diagnosticOperations = new Set([
  'system.inspect', 'file.read', 'file.stat', 'file.list', 'file.write',
  'process.run', 'serial.capture', 'serial.exchange',
]);
const tools = new Set(['diagnose_start', 'diagnose_batch', 'diagnose_wait', 'diagnose_cancel']);

type Json = Record<string, unknown>;
type Endpoint = { port: number; secret: string };

function record(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Json;
}

async function readJson(stream: NodeJS.ReadableStream): Promise<Json> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const part of stream) {
    const bytes = Buffer.from(part);
    length += bytes.length;
    if (length > 2 * 1024 * 1024) throw new Error('JSON request is too large');
    chunks.push(bytes);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON on stdin or in session request'); }
  return record(parsed);
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function validateCall(name: unknown, args: Json): asserts name is string {
  if (typeof name !== 'string' || !tools.has(name)) throw new Error('Unsupported tool for a skill session');
  if (name === 'diagnose_start' && !diagnosticOperations.has(String(args.operation))) throw new Error('Unsupported operation for a skill session');
  if (name === 'diagnose_batch' && (!Array.isArray(args.steps) || args.steps.some(step => !diagnosticOperations.has(String(record(step).operation))))) {
    throw new Error('Unsupported batch operation for a skill session');
  }
}

async function serve(relay: string): Promise<void> {
  if (!process.send || !process.connected) throw new Error('Skill session worker must be started by the CLI');
  const secret = randomBytes(32).toString('hex');
  const client = new Client({ name: 'diagnose-skill-session', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', relay], stderr: 'ignore' });
  let idle: NodeJS.Timeout | undefined;
  let stopped = false;
  let closing = false;
  let connected = false;
  let busy = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(idle);
    server.close();
    server.closeAllConnections();
    void client.close().catch(() => {});
    if (process.connected) process.disconnect?.();
  };
  const refreshIdle = (ms = DEFAULT_IDLE_MS) => {
    clearTimeout(idle);
    idle = setTimeout(stop, ms);
  };
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.authorization !== 'Bearer ' + secret) {
      respond(response, 403, { error: 'Invalid skill session' });
      return;
    }
    if (request.method !== 'POST' || !['/pair', '/call', '/close'].includes(request.url ?? '')) {
      respond(response, 404, { error: 'Unknown skill session action' });
      return;
    }
    if (closing) { respond(response, 409, { error: 'Skill session is closing' }); return; }
    if (request.url === '/close') {
      closing = true;
      if (connected) await client.callTool({ name: 'diagnose_disconnect', arguments: {} }, undefined, { timeout: 3000 }).catch(() => {});
      response.once('finish', stop);
      respond(response, 200, { disconnected: true });
      return;
    }
    if (busy) {
      respond(response, 409, { error: 'Another call is in progress for this session' });
      return;
    }
    busy = true;
    let activity = false;
    try {
      const input = await readJson(request);
      let name: string;
      let args: Json;
      if (request.url === '/pair') {
        if (connected) throw new Error('Skill session is already paired');
        args = { code: input.code, label: input.label };
        name = 'diagnose_pair';
      } else {
        if (!connected) throw new Error('Skill session is not paired');
        args = record(input.arguments);
        validateCall(input.tool, args);
        name = input.tool;
        activity = true;
        refreshIdle();
      }
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: requestMs,
        ...(name === 'diagnose_pair' && { onprogress: ({ progress }) => {
          if (progress < pairingProgress.length && process.connected) process.send?.({ progress }, () => {});
        } }),
      });
      if (result.isError) {
        const content = result.content;
        const error = Array.isArray(content) ? content.find(item => item.type === 'text')?.text : undefined;
        respond(response, 400, { error: typeof error === 'string' ? error : 'Diagnose rejected the request' });
      } else {
        if (name === 'diagnose_pair') {
          connected = true;
          refreshIdle();
        }
        respond(response, 200, result.structuredContent ?? result.content);
      }
    } catch (error) {
      respond(response, 400, { error: (error as Error).message });
    } finally {
      busy = false;
      if (activity && !stopped) refreshIdle();
    }
  };
  const server = createServer((request, response) => { void handle(request, response); });
  server.maxConnections = 8;
  server.requestTimeout = requestMs;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  client.onclose = stop;
  try {
    await client.connect(transport, { timeout: 15_000 });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, loopback, resolve);
    });
    const port = (server.address() as { port: number }).port;
    refreshIdle(requestMs + 25_000);
    process.send({ port, secret });
  } catch (error) {
    stop();
    throw error;
  }
}

function endpoint(value: unknown): Endpoint {
  if (typeof value !== 'string' || !/^\d{1,5}\.[a-f0-9]{64}$/.test(value)) throw new Error('Invalid skill session handle');
  const [port, secret] = value.split('.');
  if (Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid skill session handle');
  return { port: Number(port), secret: secret! };
}

async function requestSession(session: Endpoint, action: string, body: Json = {}): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(`http://${loopback}:${session.port}/${action}`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + session.secret, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestMs + 5000),
    });
  } catch {
    throw new Error('Skill session unavailable or timed out. Inspect the result before retrying a change.');
  }
  const result = record(await response.json());
  if (!response.ok) throw new Error(String(result.error ?? 'Skill session request failed'));
  return result;
}

async function open(input: Json): Promise<Json> {
  if (typeof input.code !== 'string' || input.code.length > 120 || !input.code.trim()) throw new Error('Supply the one-time pairing code on stdin');
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 120) throw new Error('Supply a diagnostic label on stdin');
  if (input.relay !== undefined && typeof input.relay !== 'string') throw new Error('Invalid relay URL');
  const relay = input.relay ?? defaultRelay;
  relayUrl(relay);
  console.error('Connecting to the Diagnose relay.');
  const worker = fork(cli, ['skill-session', '_serve', relay], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    const session = await new Promise<Endpoint>((resolve, reject) => {
      const done = (error?: Error, result?: Endpoint) => {
        clearTimeout(timer);
        worker.off('error', failed);
        worker.off('exit', exited);
        worker.off('message', ready);
        if (error) reject(error);
        else resolve(result!);
      };
      const failed = (error: Error) => done(error);
      const exited = () => done(new Error('Skill session worker exited during startup'));
      const ready = (message: Endpoint) => {
        try { done(undefined, endpoint(`${message.port}.${message.secret}`)); }
        catch (error) { done(error as Error); }
      };
      const timer = setTimeout(() => done(new Error('Skill session worker did not start')), 20_000);
      worker.once('error', failed);
      worker.once('exit', exited);
      worker.once('message', ready);
    });
    worker.on('message', (message: { progress?: number }) => {
      if (typeof message.progress !== 'number') return;
      const text = pairingProgress[message.progress - 1];
      if (text) console.error(text);
    });
    const result = await requestSession(session, 'pair', { code: input.code, label: input.label });
    console.error(pairingProgress[2]);
    worker.disconnect();
    worker.unref();
    return { ...result, session: session.port + '.' + session.secret, idleSeconds: DEFAULT_IDLE_MS / 1000 };
  } catch (error) {
    worker.kill();
    throw error;
  }
}

export async function skillSessionCommand(args: string[]): Promise<void> {
  if (args[0] === '_serve' && args.length === 2) {
    await serve(args[1]!);
    return;
  }
  const [action] = args;
  if (args.length !== 1 || !['open', 'call', 'close'].includes(action ?? '')) {
    throw new Error('Usage: diagnose skill-session open|call|close (JSON on stdin)');
  }
  const input = await readJson(process.stdin);
  const result = action === 'open' ? await open(input)
    : await requestSession(endpoint(input.session), action!, action === 'call' ? { tool: input.tool, arguments: input.arguments } : {});
  console.log(JSON.stringify(result));
}
