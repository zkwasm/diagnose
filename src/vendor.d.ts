declare module 'noise-handshake' {
  export default class Noise {
    constructor(pattern: string, initiator: boolean, staticKeypair?: unknown, options?: Record<string, unknown>);
    initialise(prologue: Buffer): void;
    send(payload?: Buffer): Buffer;
    recv(message: Buffer): Buffer;
    complete: boolean;
    tx: Buffer;
    rx: Buffer;
    hash: Buffer;
    e: { publicKey: Buffer; secretKey: Buffer } | null;
    psk: Buffer | null;
  }
}
declare module 'noise-handshake/cipher.js' {
  export default class Cipher {
    constructor(key: Buffer);
    encrypt(plaintext: Buffer, ad?: Buffer): Buffer;
    decrypt(ciphertext: Buffer, ad?: Buffer): Buffer;
    _clear(): void;
  }
}
