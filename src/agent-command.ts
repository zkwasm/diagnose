import { access, readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';

// npm's Windows .cmd wrappers are not executables. Resolve their Node entry
// point instead of interpolating user prompts or JSON through cmd.exe.
export async function agentCommand(name: string, args: string[], env: NodeJS.ProcessEnv, platform: string = process.platform): Promise<{ command: string; args: string[] }> {
  if (platform !== 'win32') return { command: name, args };
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of path.split(';').filter(Boolean)) {
    for (const extension of ['.exe', '.cmd']) {
      const candidate = join(directory.replace(/^"|"$/g, ''), name + extension);
      try { await access(candidate); } catch { continue; }
      if (extension === '.exe') return { command: candidate, args };
      const wrapper = await readFile(candidate, 'utf8');
      const match = /"%dp0%[\\/]([^"\r\n]+\.(?:cjs|mjs|js))"/i.exec(wrapper);
      if (!match) throw new Error(`Unsupported ${name}.cmd launcher. Install the official npm package or native executable; Diagnose will not pass prompts through a shell.`);
      const entry = resolve(dirname(candidate), match[1].replace(/\\/g, '/'));
      const diff = relative(dirname(candidate), entry);
      if (diff.startsWith('..') || isAbsolute(diff)) throw new Error('Agent npm entry point is outside its installation directory');
      await access(entry);
      return { command: process.execPath, args: [entry, ...args] };
    }
  }
  throw new Error(`${name} was not found on PATH. Install and sign in to its CLI first.`);
}
