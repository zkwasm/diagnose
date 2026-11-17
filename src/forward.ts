import net from 'node:net';
import type { Operator } from './operator.js';
export type Forward = { id: string; direction: string; host: string; port: number; readonly closed: boolean; close: () => Promise<void> };
async function write(socket: net.Socket, bytes: Buffer): Promise<void> { await new Promise<void>((resolve, reject) => socket.write(bytes, error => error ? reject(error) : resolve())); }
export async function forward(operator: Operator, id: string, localPort = 0): Promise<Forward> {
  const meta = await operator.resource({ id, action: 'status' }) as { kind: string; direction: string; host: string; port: number; bindHost?: string; listeningPort?: number };
  if (meta.kind !== 'forward') throw new Error('First authorize a net.forward resource');
  let closed = false, server: net.Server | undefined; const sockets = new Set<net.Socket>();
  const attach = (socket: net.Socket, connectionId: string): void => {
    sockets.add(socket); socket.on('error', () => socket.destroy());
    socket.on('data', bytes => { socket.pause(); void (async () => { for (let offset = 0; offset < bytes.length; offset += 65536) await operator.resource({ id: connectionId, action: 'input', data: bytes.subarray(offset, offset + 65536).toString('base64') }); socket.resume(); })().catch(() => socket.destroy()); });
    socket.on('end', () => { void operator.resource({ id: connectionId, action: 'input', data: '', eof: true }).catch(() => socket.destroy()); });
    socket.on('close', () => { sockets.delete(socket); void operator.resource({ id: connectionId, action: 'close' }).catch(() => {}); });
    void (async () => { while (!closed && !socket.destroyed) { const result = await operator.resource({ id: connectionId, action: 'read' }) as { data: string; ended: boolean }; if (result.data) await write(socket, Buffer.from(result.data, 'base64')); if (result.ended) { socket.end(); break; } if (!result.data) await new Promise(resolve => setTimeout(resolve, 25)); } })().catch(() => socket.destroy());
    socket.resume();
  };
  const connect = async (socket: net.Socket, host?: string, port?: number): Promise<void> => { const connection = await operator.resource({ id, action: 'connect', host, port }) as { id: string }; attach(socket, connection.id); };
  const stop = async (): Promise<void> => { if (closed) return; closed = true; server?.close(); for (const socket of sockets) socket.destroy(); await operator.resource({ id, action: 'close' }).catch(() => {}); };
  operator.peer.once('closed', () => { void stop(); });
  if (meta.direction === 'remote') {
    void (async () => {
      while (!closed) {
        const result = await operator.resource({ id, action: 'accept' }) as { connections: string[] };
        for (const connectionId of result.connections) { const socket = net.createConnection({ host: meta.host, port: meta.port, allowHalfOpen: true }); socket.pause(); socket.once('connect', () => attach(socket, connectionId)); socket.once('error', () => { void operator.resource({ id: connectionId, action: 'close' }).catch(() => {}); }); }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    })().catch(() => { void stop(); });
    return { id, direction: meta.direction, host: meta.bindHost ?? '127.0.0.1', port: meta.listeningPort!, get closed() { return closed; }, close: stop };
  }
  server = net.createServer({ allowHalfOpen: true }, socket => {
    socket.pause(); socket.on('error', () => socket.destroy());
    if (meta.direction !== 'socks') { void connect(socket).catch(() => socket.destroy()); return; }
    let buffer = Buffer.alloc(0), greeted = false;
    const handshake = (bytes: Buffer): void => {
      buffer = Buffer.concat([buffer, bytes]); if (buffer.length > 4096) { socket.destroy(); return; }
      if (!greeted) { if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return; if (buffer[0] !== 5 || !buffer.subarray(2, 2 + buffer[1]).includes(0)) { socket.end(Buffer.from([5, 255])); return; } const count = 2 + buffer[1]; buffer = buffer.subarray(count); greeted = true; socket.write(Buffer.from([5, 0])); }
      if (buffer.length < 5) return; if (buffer[0] !== 5 || buffer[1] !== 1) { socket.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      let host: string, end: number;
      if (buffer[3] === 1) { end = 8; if (buffer.length < end + 2) return; host = [...buffer.subarray(4, 8)].join('.'); }
      else if (buffer[3] === 3) { end = 5 + buffer[4]; if (buffer.length < end + 2) return; host = buffer.subarray(5, end).toString('utf8'); }
      else if (buffer[3] === 4) { end = 20; if (buffer.length < end + 2) return; host = Array.from({ length: 8 }, (_, i) => buffer.readUInt16BE(4 + 2 * i).toString(16)).join(':'); }
      else { socket.destroy(); return; }
      const port = buffer.readUInt16BE(end), remainder = buffer.subarray(end + 2); socket.pause(); socket.off('data', handshake);
      void (async () => { const connection = await operator.resource({ id, action: 'connect', host, port }) as { id: string }; await write(socket, Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); if (remainder.length) socket.unshift(remainder); attach(socket, connection.id); })().catch(() => socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
    };
    socket.on('data', handshake); socket.resume();
  });
  await new Promise<void>((resolveListen, reject) => { server!.once('error', reject); server!.listen(localPort, '127.0.0.1', () => { server!.off('error', reject); resolveListen(); }); });
  return { id, direction: meta.direction, host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, get closed() { return closed; }, close: stop };
}
