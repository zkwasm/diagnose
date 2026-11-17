import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSkill, type SessionSkill } from './skill.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 128;
const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
type Entry = { path: string; bytes: Buffer; executable: boolean };
export const skillsUsage = 'diagnose skills import NAME FILE.md|DIRECTORY\ndiagnose skills list\nLaunch: diagnose agent codex|claude|gemini --skill library:NAME@REVISION';

// Portable names only: reject separators, traversal, Windows aliases and device names.
function validPart(part: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..'].includes(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part);
}

async function readBundle(input: string): Promise<Entry[]> {
  const source = resolve(input), info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('Skill bundles cannot contain symbolic links');
  const entries: Entry[] = []; let total = 0, visited = 0;
  const add = async (file: string, path: string) => {
    if (entries.length >= MAX_FILES) throw new Error('Skill bundle exceeds 128 files');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error('Skill bundles require regular files');
      if (metadata.size > MAX_BYTES - total) throw new Error('Skill bundle exceeds 8 MiB');
      const buffer = Buffer.alloc(MAX_BYTES - total + 1); let size = 0;
      while (size < buffer.length) { const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead; }
      total += size;
      if (total > MAX_BYTES) throw new Error('Skill bundle exceeds 8 MiB');
      entries.push({ path, bytes: Buffer.from(buffer.subarray(0, size)), executable: !!(metadata.mode & 0o111) });
    } finally { await handle.close(); }
  };
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 16) throw new Error('Skill directory nesting exceeds 16 levels');
    const names = await readdir(directory); const portable = new Set<string>();
    for (const name of names.sort()) {
      if (++visited > 256) throw new Error('Skill bundle exceeds 256 directory entries');
      if (!validPart(name) || portable.has(name.toLowerCase())) throw new Error('Skill bundle contains a non-portable or duplicate path');
      portable.add(name.toLowerCase());
      const file = join(directory, name), path = prefix + name, item = await lstat(file);
      if (item.isSymbolicLink()) throw new Error('Skill bundles cannot contain symbolic links');
      if (item.isDirectory()) await walk(file, path + '/', depth + 1);
      else if (item.isFile()) await add(file, path);
      else throw new Error('Skill bundles require regular files');
    }
  };
  if (info.isDirectory()) await walk(source, '', 0);
  else { await loadSkill(source); await add(source, 'SKILL.md'); }
  if (!entries.some(entry => entry.path === 'SKILL.md')) throw new Error('Skill directory requires SKILL.md');
  await loadSkill(info.isDirectory() ? join(source, 'SKILL.md') : source);
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function digest(entries: Entry[]): string {
  // Length-delimited canonical JSON avoids ambiguous path/content concatenation.
  return createHash('sha256').update(JSON.stringify(entries.map(entry => [entry.path, entry.bytes.toString('base64')]))).digest('hex');
}

export class SkillLibrary {
  constructor(readonly root = join(homedir(), '.diagnose', 'skills')) {}

  async bundle(reference: string): Promise<{ reference: string; files: { path: string; data: string }[] }> {
    const skill = await this.load(reference);
    return { reference, files: (await readBundle(skill.baseDirectory)).map(entry => ({ path: entry.path, data: entry.bytes.toString('base64') })) };
  }

  async exportTo(reference: string, directory: string): Promise<void> {
    const bundle = await this.bundle(reference);
    await this.writeBundle(bundle.files, directory);
  }

  private async writeBundle(files: { path: string; data: string }[], directory: string): Promise<void> {
    if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Invalid skill bundle');
    let total = 0;
    for (const entry of files) {
      if (typeof entry.path !== 'string' || entry.path.length > 2048 || !entry.path.split('/').every(validPart) || typeof entry.data !== 'string') throw new Error('Invalid bundle path or content');
      const bytes = Buffer.from(entry.data, 'base64'); total += bytes.length;
      if (total > MAX_BYTES || bytes.toString('base64') !== entry.data) throw new Error('Invalid or oversized bundle content');
      const parts = entry.path.split('/'), name = parts.pop()!;
      const parent = join(directory, ...parts); await mkdir(parent, { recursive: true, mode: 0o700 });
      await writeFile(join(parent, name), bytes, { flag: 'wx', mode: 0o600 });
    }
  }

  async restore(bundle: { reference: string; files: { path: string; data: string }[] }): Promise<string> {
    const match = /^library:([a-z0-9][a-z0-9-]{0,63})@([a-f0-9]{64})$/.exec(bundle.reference);
    if (!match) throw new Error('Invalid bundle reference');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.root, '.restore-'));
    try {
      await this.writeBundle(bundle.files, directory);
      if (digest(await readBundle(directory)) !== match[2]) throw new Error('Downloaded bundle failed integrity verification');
      return await this.import(match[1], directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async import(name: string, input: string): Promise<string> {
    if (!namePattern.test(name) || !validPart(name)) throw new Error('Skill name must be a portable name of 1..64 lowercase letters, digits or hyphens, starting with a letter or digit');
    const entries = await readBundle(input), revision = digest(entries), parent = join(this.root, name);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const reference = `library:${name}@${revision}`, destination = join(parent, revision);
    try { await lstat(destination); await this.load(reference); return reference; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = await mkdtemp(join(parent, '.import-'));
    try {
      for (const entry of entries) {
        const parts = entry.path.split('/'); const filename = parts.pop()!;
        const directory = join(temporary, ...parts);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, filename), entry.bytes, { flag: 'wx', mode: entry.executable ? 0o700 : 0o600 });
      }
      if (digest(await readBundle(temporary)) !== revision) throw new Error('Skill changed during import');
      try { await rename(temporary, destination); }
      catch (error) {
        // Windows reports EPERM when another import already published this
        // nonempty directory. Accept only a fully verified existing revision,
        // never an error code alone (which could also mean real permission loss).
        try { await this.load(reference); } catch { throw error; }
      }
      await this.load(reference);
      return reference;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async load(reference: string): Promise<SessionSkill> {
    const match = /^library:([^@]+)@([^@]+)$/.exec(reference);
    if (!match || !namePattern.test(match[1]) || !validPart(match[1]) || !revisionPattern.test(match[2])) throw new Error('Use library:NAME@FULL_SHA256_REVISION from diagnose skills list');
    const directory = join(this.root, match[1], match[2]);
    if (digest(await readBundle(directory)) !== match[2]) throw new Error('Stored skill failed integrity verification; import a clean copy');
    return { ...await loadSkill(directory), libraryReference: reference };
  }

  async list(): Promise<string[]> {
    let names: string[];
    try { names = await readdir(this.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const references: string[] = [];
    for (const name of names.sort()) {
      if (!namePattern.test(name) || !(await lstat(join(this.root, name))).isDirectory()) continue;
      for (const revision of (await readdir(join(this.root, name))).sort()) {
        if (revisionPattern.test(revision)) references.push(`library:${name}@${revision}`);
      }
    }
    return references;
  }
}

export async function resolveSkill(input: string): Promise<SessionSkill> {
  return input.startsWith('library:') ? new SkillLibrary().load(input) : loadSkill(input);
}

export async function skillsCommand(args: string[]): Promise<void> {
  const library = new SkillLibrary();
  if (args[0] === 'import' && args.length === 3) { console.log(await library.import(args[1], args[2])); return; }
  if (args[0] === 'list' && args.length === 1) { console.log(JSON.stringify(await library.list(), null, 2)); return; }
  if (args.length && !['--help', 'help'].includes(args[0])) throw new Error(skillsUsage);
  console.log(skillsUsage);
}
