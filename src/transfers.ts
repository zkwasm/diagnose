import { open, stat, rename, writeFile, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Operator } from './operator.js';
export type TransferProgress = { state: string; bytes: number; size: number; resourceId?: string; resumeToken?: string; sha256?: string; error?: string };
export type TransferOptions = { resumeId?: string; resumeToken?: string; overwrite?: boolean; signal?: AbortSignal; progress?: (progress: TransferProgress) => void };
type Descriptor = { id: string; resumeToken?: string; size: number; sha256: string; offset: number };
async function hash(path: string): Promise<string> { const file = await open(path, 'r'); try { const value = createHash('sha256'); for await (const bytes of file.createReadStream({ autoClose: false })) value.update(bytes); return value.digest('hex'); } finally { await file.close(); } }
async function grant(operator: Operator, input: Parameters<Operator['run']>[0], options: TransferOptions): Promise<Descriptor> {
  options.signal?.throwIfAborted(); const id = await operator.start(options.resumeId ? { operation: 'resource.resume', arguments: { id: options.resumeId, resumeToken: options.resumeToken }, reason: input.reason } : input);
  const abort = () => { void operator.cancel(id).catch(() => {}); }; options.signal?.addEventListener('abort', abort, { once: true });
  try { while (true) { if (options.signal?.aborted) { abort(); options.signal.throwIfAborted(); } const result = await operator.wait(id, 1000); if (!('pending' in result)) { if (result.result.status !== 'ok') throw new Error(result.result.error ?? result.result.status); return result.result.data as Descriptor; } } }
  finally { options.signal?.removeEventListener('abort', abort); operator.release(id); }
}
export async function upload(operator: Operator, localPath: string, remotePath: string, reason: string, options: TransferOptions = {}): Promise<TransferProgress> {
  const size = (await stat(localPath)).size, checksum = await hash(localPath);
  const resource = await grant(operator, { operation: 'file.transfer', arguments: { direction: 'upload', path: remotePath, size, sha256: checksum, overwrite: options.overwrite ?? false }, reason }, options);
  if (resource.size !== size || resource.sha256 !== checksum) throw new Error('Resume target does not match the selected local file');
  const progress: TransferProgress = { state: 'uploading', bytes: resource.offset, size, resourceId: resource.id, resumeToken: resource.resumeToken ?? options.resumeToken, sha256: checksum }; options.progress?.({ ...progress });
  const file = await open(localPath, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    while (progress.bytes < size) { options.signal?.throwIfAborted(); const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - progress.bytes), progress.bytes); if (!bytesRead) throw new Error('Local upload source changed'); await operator.resource({ id: resource.id, action: 'input', data: buffer.subarray(0, bytesRead).toString('base64') }); progress.bytes += bytesRead; options.progress?.({ ...progress }); }
    options.signal?.throwIfAborted(); await operator.resource({ id: resource.id, action: 'commit' }); progress.state = 'completed'; options.progress?.({ ...progress }); return progress;
  } finally { await file.close(); }
}
export async function download(operator: Operator, remotePath: string, localPath: string, reason: string, options: TransferOptions = {}): Promise<TransferProgress> {
  const destination = resolve(localPath), partial = destination + '.diagnose.part', sidecar = destination + '.diagnose.json';
  try { await stat(destination); if (!options.overwrite) throw new Error('Local target exists; explicit overwrite is required'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let saved: { resourceId: string; resumeToken: string; sha256: string } | undefined;
  try { saved = JSON.parse(await readFile(sidecar, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const effective = options.resumeId ? options : saved ? { ...options, resumeId: saved.resourceId, resumeToken: saved.resumeToken } : options;
  const resource = await grant(operator, { operation: 'file.transfer', arguments: { direction: 'download', path: remotePath }, reason }, effective);
  if (saved && saved.sha256 !== resource.sha256) throw new Error('Partial download belongs to a different source');
  const file = await open(partial, 'a+', 0o600), bytes = (await file.stat()).size;
  const progress: TransferProgress = { state: 'downloading', bytes, size: resource.size, resourceId: resource.id, resumeToken: resource.resumeToken ?? effective.resumeToken, sha256: resource.sha256 };
  await writeFile(sidecar, JSON.stringify(progress), { mode: 0o600 }); options.progress?.({ ...progress });
  try {
    while (progress.bytes < resource.size) {
      options.signal?.throwIfAborted(); const result = await operator.resource({ id: resource.id, action: 'read', cursor: progress.bytes }) as { data: string; nextOffset: number };
      const block = Buffer.from(result.data, 'base64'); if (!block.length || result.nextOffset !== progress.bytes + block.length) throw new Error('Invalid download response');
      await file.writeFile(block); progress.bytes += block.length; options.progress?.({ ...progress });
    }
    await file.sync();
  } finally { await file.close(); }
  if (progress.bytes !== resource.size || await hash(partial) !== resource.sha256) throw new Error('Download integrity mismatch; destination untouched');
  options.signal?.throwIfAborted(); await rename(partial, destination); await unlink(sidecar); await operator.resource({ id: resource.id, action: 'close' }); progress.state = 'completed'; options.progress?.({ ...progress }); return progress;
}
