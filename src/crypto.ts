import { randomBytes, createHash } from 'node:crypto';
import Noise from 'noise-handshake';
import Cipher from 'noise-handshake/cipher.js';

export const NOISE_PROTOCOL = 'Noise_NNpsk0_25519_ChaChaPoly_BLAKE2b';
export function createCode(): string { return `D1.${randomBytes(12).toString('base64url')}.${randomBytes(32).toString('base64url')}`; }
export function parseCode(code: string): { room: string; secret: Buffer } {
  const match = /^D1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(code.trim());
  if (!match) throw new Error('Invalid pairing code');
  const secret = Buffer.from(match[2], 'base64url');
  if (secret.length !== 32 || secret.toString('base64url') !== match[2]) throw new Error('Invalid pairing secret');
  return { room: match[1], secret };
}

export class Handshake {
  private state: Noise;
  constructor(initiator: boolean, room: string, secret: Buffer) {
    this.state = new Noise('NNpsk0', initiator, undefined, { psk: Buffer.from(secret) });
    this.state.initialise(Buffer.from(`diagnose/v1\0${room}\0operator->probe\0${NOISE_PROTOCOL}`));
  }
  send(payload: Buffer): Buffer { return this.state.send(payload); }
  receive(bytes: Buffer): Buffer { return this.state.recv(bytes); }
  split(): SecureCipher {
    if (!this.state.complete) throw new Error('Handshake not complete');
    const result = new SecureCipher(Buffer.from(this.state.tx), Buffer.from(this.state.rx), Buffer.from(this.state.hash));
    this.destroy(); return result;
  }
  destroy(): void {
    this.state.psk?.fill(0); this.state.tx?.fill(0); this.state.rx?.fill(0);
    this.state.e?.secretKey.fill(0);
  }
}

export class SecureCipher {
  private sendCipher: Cipher;
  private receiveCipher: Cipher;
  private sent = 0;
  private received = 0;
  readonly fingerprint: string;
  constructor(tx: Buffer, rx: Buffer, hash: Buffer) {
    this.sendCipher = new Cipher(tx); this.receiveCipher = new Cipher(rx);
    this.fingerprint = createHash('sha256').update(hash).digest('hex').slice(0, 24).match(/.{4}/g)!.join('-');
  }
  encrypt(bytes: Buffer): Buffer {
    // The dependency encodes a 32-bit transport counter. End sessions far before rollover.
    if (++this.sent > 1_000_000) throw new Error('Session message limit reached; pair again');
    return this.sendCipher.encrypt(bytes);
  }
  decrypt(bytes: Buffer): Buffer {
    if (++this.received > 1_000_000) throw new Error('Session message limit reached; pair again');
    return this.receiveCipher.decrypt(bytes);
  }
  destroy(): void { this.sendCipher._clear(); this.receiveCipher._clear(); }
}
