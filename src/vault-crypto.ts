import { createHash, createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export const MAX_VAULT_OBJECT = 12 * 1024 * 1024;
export function newRecovery(): string { return 'K1.' + randomBytes(32).toString('base64url'); }
export function vaultKeys(recovery: string) {
  if (!/^K1\.[A-Za-z0-9_-]{43}$/.test(recovery)) throw new Error('Invalid library recovery key');
  const root = Buffer.from(recovery.slice(3), 'base64url');
  if (root.toString('base64url') !== recovery.slice(3)) throw new Error('Noncanonical recovery key');
  const derive = (purpose: string) => Buffer.from(hkdfSync('sha256', root, 'diagnose-library-v1', purpose, 32));
  const auth = derive('authentication').toString('base64url');
  return { auth, namespace: createHash('sha256').update(auth).digest('hex'), encryption: derive('encryption'), index: derive('object-names') };
}
export function objectId(recovery: string, reference: string): string { return createHmac('sha256', vaultKeys(recovery).index).update(reference).digest('hex'); }
export function sealBundle(recovery: string, id: string, bytes: Buffer): Buffer {
  const keys = vaultKeys(recovery), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keys.encryption, nonce);
  cipher.setAAD(Buffer.from(`diagnose-library-v1:${keys.namespace}:${id}`));
  const sealed = Buffer.concat([Buffer.from([1]), nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  if (sealed.length > MAX_VAULT_OBJECT) throw new Error('Encrypted bundle exceeds 12 MiB');
  return sealed;
}
export function openBundle(recovery: string, id: string, sealed: Buffer): Buffer {
  if (sealed.length < 29 || sealed.length > MAX_VAULT_OBJECT || sealed[0] !== 1) throw new Error('Invalid encrypted library object');
  const keys = vaultKeys(recovery), decipher = createDecipheriv('aes-256-gcm', keys.encryption, sealed.subarray(1, 13));
  decipher.setAAD(Buffer.from(`diagnose-library-v1:${keys.namespace}:${id}`)); decipher.setAuthTag(sealed.subarray(-16));
  return Buffer.concat([decipher.update(sealed.subarray(13, -16)), decipher.final()]);
}
