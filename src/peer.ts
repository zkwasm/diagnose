import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { Handshake, parseCode, type SecureCipher } from './crypto.js';
import { CHUNK_SIZE, MAX_FRAME, parseMessage, type WireMessage } from './schema.js';
import { safeText } from './util.js';

export type PeerOptions = { role: 'host' | 'join'; code: string; relay: string; label?: string; remember?: boolean; provision?: () => string | undefined; accept?: (peer: { label: string; fingerprint: string; signal: AbortSignal; remember: boolean }) => Promise<boolean>; approvalTimeoutMs?: number; sessionMs?: number };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); return { promise, resolve, reject }; }
export function relayUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.username || url.password || url.search || url.hash || !['wss:', 'ws:'].includes(url.protocol)) throw new Error('Invalid relay URL');
  if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Remote relays require TLS');
  url.pathname = '/v1/connect'; return url.href;
}

export class Peer extends EventEmitter {
  private ws: WebSocket;
  private secret: Buffer;
  private room: string;
  private handshake?: Handshake;
  private cipher?: SecureCipher;
  private registered = deferred<void>();
  private accepted = deferred<void>();
  private endedState = deferred<string>();
  readonly active = this.accepted.promise;
  readonly ended = this.endedState.promise;
  private approved = false;
  private destroyed = false;
  private generation = 0;
  private approval?: AbortController;
  private queue: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private parts: Buffer[] = [];
  private partialSize = 0;
  private lastSeen = Date.now();
  private heartbeat?: NodeJS.Timeout;
  private connectionTimer: NodeJS.Timeout;
  private handshakeTimer?: NodeJS.Timeout;
  fingerprint = '';
  rememberedCode?: string;

  constructor(private options: PeerOptions) {
    super();
    const { room, secret } = parseCode(options.code); this.room = room; this.secret = secret;
    this.ws = new WebSocket(relayUrl(options.relay), { maxPayload: MAX_FRAME, perMessageDeflate: false, handshakeTimeout: 10000 });
    this.connectionTimer = setTimeout(() => this.close('Relay registration timeout'), 12000);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ version: 1, role: options.role, room })));
    this.ws.on('error', () => this.close('Relay connection failed'));
    this.ws.on('close', () => this.close('Relay disconnected'));
    this.ws.on('message', (bytes, binary) => {
      try {
        if (binary) this.receive(Buffer.from(bytes as Buffer));
        else this.control(JSON.parse(bytes.toString()));
      } catch {
        if (options.role === 'host' && !this.approved) this.rejectAttempt();
        else this.close('Authentication or protocol check failed');
      }
    });
  }
  async open(): Promise<this> { await this.registered.promise; if (this.options.role === 'join') await this.active; return this; }
  private control(message: { type: string }): void {
    switch (message.type) {
      case 'registered': clearTimeout(this.connectionTimer); this.registered.resolve(); break;
      case 'joined':
        clearTimeout(this.connectionTimer); this.registered.resolve();
        this.handshake = new Handshake(true, this.room, this.secret);
        this.ws.send(this.handshake.send(Buffer.from(JSON.stringify({ role: 'operator', label: (this.options.label ?? 'Diagnostic operator').slice(0, 120), ...(this.options.remember ? { remember: true } : {}) }))));
        this.handshakeTimer = setTimeout(() => this.close('Pairing or user approval timeout'), this.options.approvalTimeoutMs ?? 120000);
        break;
      case 'peer':
        if (this.options.role !== 'host' || this.approved) throw new Error('Unexpected peer');
        this.handshake?.destroy(); this.handshake = new Handshake(false, this.room, this.secret);
        clearTimeout(this.handshakeTimer);
        this.handshakeTimer = setTimeout(() => this.rejectAttempt(), 15000);
        break;
      case 'peer-left':
        if (this.approved) this.close('Operator disconnected'); else this.resetAttempt();
        break;
      default: throw new Error('Unexpected relay control');
    }
  }
  private receive(bytes: Buffer): void {
    if (!this.cipher) {
      if (!this.handshake || bytes.length > 4096) throw new Error('Invalid handshake');
      const hello = JSON.parse(this.handshake.receive(bytes).toString());
      if (typeof hello.label !== 'string' || hello.label.length > 120 || hello.role !== (this.options.role === 'host' ? 'operator' : 'probe')) throw new Error('Invalid peer hello');
      if (this.options.role === 'host') {
        const reply = this.handshake.send(Buffer.from(JSON.stringify({ role: 'probe', label: (this.options.label ?? 'User probe').slice(0, 120) })));
        this.cipher = this.handshake.split(); this.handshake = undefined; this.fingerprint = this.cipher.fingerprint;
        this.ws.send(reply);
        clearTimeout(this.handshakeTimer);
        const generation = ++this.generation;
        this.approval = new AbortController();
        const timer = setTimeout(() => { this.approval?.abort(); this.close('Pairing approval timeout'); }, this.options.approvalTimeoutMs ?? 120000);
        this.handshakeTimer = timer;
        void (async () => {
          const allowed = await this.options.accept?.({ label: safeText(hello.label), fingerprint: this.fingerprint, signal: this.approval!.signal, remember: hello.remember === true });
          clearTimeout(timer);
          if (this.destroyed || generation !== this.generation) return;
          if (!allowed || this.approval?.signal.aborted) { await this.send({ type: 'session.closed', reason: 'User declined pairing' }); this.close('User declined pairing'); return; }
          this.ws.send(JSON.stringify({ type: 'lock', ...(this.options.sessionMs === undefined ? {} : { ttlMs: this.options.sessionMs || 7 * 86400000 }) }));
          this.approved = true;
          await this.send({ type: 'session.accepted', label: safeText(this.options.label ?? 'User probe'), fingerprint: this.fingerprint, ...(hello.remember === true && this.options.provision?.() ? { credential: this.options.provision!() } : {}) });
          this.activate();
        })().catch(() => this.close('Pairing approval failed'));
      } else {
        this.cipher = this.handshake.split(); this.handshake = undefined; this.fingerprint = this.cipher.fingerprint;
      }
      return;
    }
    const frame = this.cipher.decrypt(bytes);
    if (frame.length < 1 || frame[0] > 1) throw new Error('Bad encrypted frame');
    this.parts.push(frame.subarray(1)); this.partialSize += frame.length - 1;
    if (this.partialSize > 2 * 1024 * 1024) throw new Error('Message too large');
    if (frame[0] === 0) return;
    const message = parseMessage(JSON.parse(Buffer.concat(this.parts).toString())); this.parts = []; this.partialSize = 0;
    this.lastSeen = Date.now();
    if (message.type === 'session.closed') { this.close(message.reason); return; }
    if (message.type === 'session.accepted' && this.options.role === 'join' && !this.approved) {
      if (message.fingerprint !== this.fingerprint) throw new Error('Channel binding mismatch');
      if (message.credential) { if (!this.options.remember) throw new Error('Unexpected pairing credential'); parseCode(message.credential); this.rememberedCode = message.credential; }
      clearTimeout(this.handshakeTimer); this.approved = true; this.activate(); return;
    }
    if (!this.approved) throw new Error('Not authorized');
    if (message.type === 'ping') { void this.send({ type: 'pong' }).catch(() => this.close('Heartbeat failed')); return; }
    if (message.type === 'pong') return;
    this.emit('message', message);
  }
  private activate(): void {
    this.secret.fill(0); this.lastSeen = Date.now(); this.accepted.resolve(); this.emit('active');
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 25000) { this.close('Peer heartbeat timeout'); return; }
      void this.send({ type: 'ping' }).catch(() => this.close('Heartbeat failed'));
    }, 5000);
    this.heartbeat.unref();
  }
  send(message: WireMessage): Promise<void> {
    if (!this.cipher || this.destroyed) return Promise.reject(new Error('Encrypted connection unavailable'));
    const payload = Buffer.from(JSON.stringify(message));
    if (payload.length > 2 * 1024 * 1024 || this.queuedBytes + payload.length > 4 * 1024 * 1024) return Promise.reject(new Error('Send queue exceeded'));
    this.queuedBytes += payload.length;
    const operation = this.queue.then(async () => {
      for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
        if (this.destroyed || !this.cipher) throw new Error('Connection closed');
        const part = payload.subarray(offset, offset + CHUNK_SIZE);
        const frame = Buffer.concat([Buffer.from([offset + part.length === payload.length ? 1 : 0]), part]);
        await this.writeRaw(this.cipher.encrypt(frame));
        // Bound sustained traffic below the relay's shared per-room frame budget.
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }).finally(() => { this.queuedBytes -= payload.length; });
    this.queue = operation.catch(() => this.close('Encrypted transport failed'));
    return operation;
  }
  private writeRaw(bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => { if (this.ws.readyState !== WebSocket.OPEN) { reject(new Error('Socket closed')); return; } this.ws.send(bytes, { binary: true }, error => error ? reject(error) : resolve()); });
  }
  private resetAttempt(): void {
    this.generation++; this.approval?.abort(); clearTimeout(this.handshakeTimer);
    this.handshake?.destroy(); this.handshake = undefined; this.cipher?.destroy(); this.cipher = undefined;
    this.parts = []; this.partialSize = 0;
  }
  private rejectAttempt(): void {
    this.resetAttempt();
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'reject' }));
  }
  close(reason = 'Session ended'): void {
    if (this.destroyed) return;
    this.destroyed = true; clearTimeout(this.connectionTimer); clearInterval(this.heartbeat); this.resetAttempt(); this.secret.fill(0);
    const error = new Error(reason); this.registered.reject(error); this.accepted.reject(error); this.endedState.resolve(reason);
    this.ws.close(1000, 'Session ended'); const kill = setTimeout(() => this.ws.terminate(), 1000); kill.unref();
    this.emit('closed', reason);
  }
}
