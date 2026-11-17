import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { stat, chmod } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
// node-pty 1.1.0's macOS prebuilt helper is shipped without its executable bit.
// Repair only that bundled helper, during installation and as a runtime fallback.
export async function preparePty(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  for (const path of [join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'), join(root, 'build', 'Release', 'spawn-helper')]) {
    try { const info = await stat(path); if (info.isFile() && !(info.mode & 0o100)) await chmod(path, info.mode | 0o100); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await preparePty();
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) preparePty().catch(() => { console.error('Unable to prepare bundled PTY helper. Reinstall diagnose with write permission to its installation directory.'); process.exitCode = 1; });
