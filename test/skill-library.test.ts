import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillLibrary } from '../dist/skill-library.js';

test('library imports complete bundles, deduplicates and keeps launchable old revisions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diagnose-library-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), library = new SkillLibrary(join(root, 'library'));
  await mkdir(join(source, 'references'), { recursive: true }); await mkdir(join(source, 'scripts'));
  await writeFile(join(source, 'SKILL.md'), '# Gateway\nRead references/profile.md.');
  await writeFile(join(source, 'references/profile.md'), 'Model A');
  await writeFile(join(source, 'scripts/check.sh'), 'exit 99\n');
  const first = await library.import('gateway', source);
  assert.equal(await library.import('gateway', source), first);
  const loaded = await library.load(first);
  assert.equal(loaded.libraryReference, first);
  assert.equal(await readFile(join(loaded.baseDirectory, 'scripts/check.sh'), 'utf8'), 'exit 99\n');
  await writeFile(join(source, 'references/profile.md'), 'Model B');
  const second = await library.import('gateway', source); assert.notEqual(second, first);
  assert.equal(await readFile(join((await library.load(first)).baseDirectory, 'references/profile.md'), 'utf8'), 'Model A');
  assert.deepEqual((await library.list()).sort(), [first, second].sort());
  await writeFile(join(loaded.baseDirectory, 'references/profile.md'), 'Tampered');
  await assert.rejects(library.load(first), /integrity/);
});

test('single Markdown import is isolated from adjacent files and validates references', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diagnose-library-file-')); t.after(() => rm(root, { recursive: true, force: true }));
  const library = new SkillLibrary(join(root, 'library')), file = join(root, 'task.md');
  assert.deepEqual(await library.list(), []);
  await writeFile(file, '# Read-only check'); await writeFile(join(root, 'secret.txt'), 'Do not import');
  const reference = await library.import('gateway', file), loaded = await library.load(reference);
  assert.equal(loaded.instructions, '# Read-only check');
  await assert.rejects(readFile(join(loaded.baseDirectory, 'secret.txt')), /ENOENT/);
  for (const name of ['../escape', 'Uppercase', '', 'con']) await assert.rejects(library.import(name, file), /name/);
  for (const ref of ['library:../escape@' + 'a'.repeat(64), 'library:gateway@latest', 'library:gateway']) await assert.rejects(library.load(ref), /FULL_SHA256/);
});

test('bundle import rejects symlinks, non-portable paths and oversized resources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diagnose-library-invalid-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), library = new SkillLibrary(join(root, 'library'));
  await mkdir(source); await writeFile(join(source, 'SKILL.md'), '# Device');
  await writeFile(join(source, 'has space.md'), 'invalid'); await assert.rejects(library.import('device', source), /portable/); await rm(join(source, 'has space.md'));
  await writeFile(join(source, 'large.bin'), Buffer.alloc(8 * 1024 * 1024)); await assert.rejects(library.import('device', source), /8 MiB/); await rm(join(source, 'large.bin'));
  if (process.platform !== 'win32') {
    await symlink(join(source, 'SKILL.md'), join(source, 'linked.md'));
    await assert.rejects(library.import('device', source), /symbolic/);
  }
  assert.deepEqual(await library.list(), []);
});

test('library rejects excessive file counts and keeps concurrent identical imports intact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diagnose-library-limits-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), library = new SkillLibrary(join(root, 'library'));
  await mkdir(source); await writeFile(join(source, 'SKILL.md'), '# Device');
  const refs = await Promise.all([library.import('device', source), library.import('device', source)]);
  assert.equal(refs[0], refs[1]); await library.load(refs[0]);
  for (let i = 0; i < 128; i++) await writeFile(join(source, `reference-${i}.md`), 'Reference');
  await assert.rejects(library.import('device', source), /128 files/);
  assert.deepEqual(await library.list(), [refs[0]]);
});
