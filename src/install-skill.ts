import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const installSkillUsage = 'diagnose install-skill claude|codex|gemini';
const locations = new Map([
  ['claude', { directory: '.claude', invocation: '/diagnose' }],
  ['codex', { directory: '.agents', invocation: '$diagnose' }],
  ['gemini', { directory: '.gemini', invocation: 'Use the Diagnose skill' }],
]);

export async function installSkill(args: string[]): Promise<void> {
  const agent = args.length === 1 ? locations.get(args[0]!) : undefined;
  if (!agent) throw new Error('Usage: ' + installSkillUsage);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = join(root, 'skills', 'connect');
  const library = join(homedir(), agent.directory, 'skills');
  const target = join(library, 'diagnose');
  const [skill, helper] = await Promise.all([
    readFile(join(source, 'SKILL.md'), 'utf8'),
    readFile(join(source, 'scripts/run.mjs')),
  ]);
  const files = new Map([
    ['SKILL.md', Buffer.from(skill.replace(/^name: connect$/m, 'name: diagnose'))],
    ['scripts/run.mjs', helper],
  ]);
  const runtime = 'scripts/local-runtime.json';
  if (existsSync(join(root, '.git'))) {
    files.set(runtime, Buffer.from(JSON.stringify({ cli: join(root, 'dist', 'cli.js') }) + '\n'));
  }

  await mkdir(library, { recursive: true, mode: 0o700 });
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const sameFiles = (await Promise.all([...files].map(async ([file, bytes]) =>
      (await readFile(join(target, file)).catch(() => undefined))?.equals(bytes) === true
    ))).every(Boolean) && (files.has(runtime) || !existsSync(join(target, runtime)));
    if (!sameFiles) throw new Error('A different Skill already exists at ' + target + '. Move it before installing.');
    console.log('Diagnose Skill is already installed at ' + target);
    console.log('In a new agent session, use ' + agent.invocation + '.');
    return;
  }

  try {
    await mkdir(join(target, 'scripts'), { mode: 0o700 });
    for (const [file, bytes] of files) await writeFile(join(target, file), bytes, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  console.log('Installed Diagnose Skill at ' + target);
  console.log('In a new agent session, use ' + agent.invocation + '.');
}
