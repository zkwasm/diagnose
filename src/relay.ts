import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_FRAME } from './schema.js';
import { VaultServer } from './vault-server.js';

export type RelayOptions = { host?: string; port?: number; invitationMs?: number; sessionMs?: number; maxRooms?: number; downloadPath?: string; vaultPath?: string; observeCiphertext?: (bytes: Buffer) => void };
type Room = { host: WebSocket; peer?: WebSocket; locked: boolean; attempts: number; expires: number; frames: number; window: number };
const control = (ws: WebSocket, type: string, extra = {}): void => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...extra })); };

export function createRelay(options: RelayOptions = {}) {
  const vault = options.vaultPath ? new VaultServer(options.vaultPath) : undefined;
  const rooms = new Map<string, Room>();
  const clients = new Map<WebSocket, { role?: 'host' | 'join'; room?: string; ip: string; alive: boolean }>();
  const connectionsByIp = new Map<string, number>();
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.url?.startsWith('/v1/library') && vault) { void vault.handle(req, res); return; }
    if (req.method === 'GET' && req.url === '/healthz') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"protocol":1}'); return; }
    if (req.method === 'GET' && req.url === '/downloads/diagnose-0.1.0.tgz' && options.downloadPath) {
      try { const size = statSync(options.downloadPath).size; res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', size); createReadStream(options.downloadPath).on('error', () => res.destroy()).pipe(res); } catch { res.writeHead(404); res.end(); } return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.writeHead(req.url === '/' ? 200 : 404);
    res.end(req.url === '/' ? 'Diagnose blind relay v1. User-approved, end-to-end encrypted diagnostics.\n' : 'Not found\n');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/v1/connect' || clients.size >= 400) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    const direct = req.socket.remoteAddress ?? 'unknown';
    const ip = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct) ? String(req.headers['x-forwarded-for'] ?? direct).split(',')[0].trim() : direct;
    if ((connectionsByIp.get(ip) ?? 0) >= 30) { ws.close(1008, 'Connection limit'); return; }
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    const state = { ip, alive: true } as { role?: 'host' | 'join'; room?: string; ip: string; alive: boolean };
    clients.set(ws, state);
    const registration = setTimeout(() => { if (!state.role) ws.close(1008, 'Registration timeout'); }, 5000);
    ws.on('pong', () => { state.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      try {
        const bytes = Buffer.from(raw as Buffer);
        if (!state.role) {
          if (binary || bytes.length > 256) throw new Error();
          const msg = JSON.parse(bytes.toString());
          if (msg.version !== 1 || !/^[A-Za-z0-9_-]{16}$/.test(msg.room) || !['host', 'join'].includes(msg.role)) throw new Error();
          if (msg.role === 'host') {
            if (rooms.has(msg.room) || rooms.size >= (options.maxRooms ?? 100)) throw new Error();
            rooms.set(msg.room, { host: ws, locked: false, attempts: 0, expires: Date.now() + (options.invitationMs ?? 600000), frames: 0, window: Date.now() });
            state.role = 'host'; state.room = msg.room; control(ws, 'registered');
          } else {
            const room = rooms.get(msg.room);
            if (!room || room.locked || room.peer || room.attempts >= 10 || room.expires < Date.now()) throw new Error();
            state.role = 'join'; state.room = msg.room; room.peer = ws; room.attempts++;
            control(room.host, 'peer'); control(ws, 'joined');
          }
          clearTimeout(registration); return;
        }
        const room = rooms.get(state.room!);
        if (!room) throw new Error();
        if (binary) {
          if (Date.now() - room.window > 1000) { room.window = Date.now(); room.frames = 0; }
          if (++room.frames > 250 || bytes.length > MAX_FRAME) throw new Error();
          const target = state.role === 'host' ? room.peer : room.host;
          if (!target || target.readyState !== WebSocket.OPEN || target.bufferedAmount > 1024 * 1024) throw new Error();
          let buffered = 0; for (const client of clients.keys()) buffered += client.bufferedAmount;
          if (buffered > 64 * 1024 * 1024) throw new Error();
          options.observeCiphertext?.(bytes);
          target.send(bytes, { binary: true }); return;
        }
        if (bytes.length > 128 || state.role !== 'host') throw new Error();
        const msg = JSON.parse(bytes.toString());
        if (msg.type === 'lock' && !room.locked) { const requested = msg.ttlMs; if (requested !== undefined && (!Number.isInteger(requested) || requested < 60000 || requested > 7 * 86400000)) throw new Error(); room.locked = true; room.expires = Date.now() + (requested ?? options.sessionMs ?? 3600000); }
        else if (msg.type === 'reject' && !room.locked) { const peer = room.peer; room.peer = undefined; peer?.close(1008, 'Pairing rejected'); }
        else throw new Error();
      } catch { ws.close(1008, 'Protocol rejected'); }
    });
    ws.on('close', () => {
      clearTimeout(registration); clients.delete(ws);
      const count = (connectionsByIp.get(ip) ?? 1) - 1;
      if (count > 0) connectionsByIp.set(ip, count); else connectionsByIp.delete(ip);
      const room = rooms.get(state.room!); if (!room) return;
      if (state.role === 'host') { rooms.delete(state.room!); room.peer?.close(1000, 'Session ended'); }
      else if (room.peer === ws) { room.peer = undefined; control(room.host, 'peer-left'); if (room.locked) room.host.close(1000, 'Peer disconnected'); }
    });
  });
  const sweep = setInterval(() => {
    for (const [id, room] of rooms) if (room.expires < Date.now()) { rooms.delete(id); room.host.close(1000, 'Session expired'); room.peer?.close(1000, 'Session expired'); }
    for (const [ws, state] of clients) { if (!state.alive) ws.terminate(); else { state.alive = false; ws.ping(); } }
  }, 10000);
  sweep.unref();
  return {
    server,
    async listen(): Promise<number> { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 8792, options.host ?? '127.0.0.1', () => { server.off('error', reject); resolve(); }); }); return (server.address() as import('node:net').AddressInfo).port; },
    async close(): Promise<void> { clearInterval(sweep); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
