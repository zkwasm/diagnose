import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSkill } from '../dist/skill.js';

test('skill loader accepts UTF-8 Markdown and preserves exact instructions and source base', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'diagnose skill '))), file = join(root, process.platform === 'win32' ? 'device with spaces.md' : 'device "quoted".md'), source = '\uFEFF# Device\nCheck port 11500. Literal $(do-not-execute).\n';
  await writeFile(file, source); const skill = await loadSkill(file);
  assert.equal(skill.sourceFile, file); assert.equal(skill.baseDirectory, root); assert.equal(skill.instructions, source.slice(1)); assert.equal(skill.sha256, createHash('sha256').update(Buffer.from(source)).digest('hex'));
});

test('skill directory resolves SKILL.md without loading unrelated files or executing scripts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'diagnose-skill-directory-'))); await mkdir(join(root, 'references')); await writeFile(join(root, 'SKILL.md'), '# Device task\nRead references/profile.md.'); await writeFile(join(root, 'references/profile.md'), 'Reference only');
  const skill = await loadSkill(root); assert.equal(skill.sourceFile, join(root, 'SKILL.md')); assert.equal(skill.baseDirectory, root); assert.ok(!skill.instructions.includes('Reference only'));
});

test('skill loader rejects missing, empty, non-Markdown, non-UTF8, and oversized inputs', async () => {
  await assert.rejects(loadSkill(''), /non-empty path/);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'diagnose-skill-invalid-')));
  await assert.rejects(loadSkill(join(root, 'missing.md')), /ENOENT/); await assert.rejects(loadSkill(root), /SKILL.md/);
  for (const [name, content, error] of [['empty.md', ' \n', /empty/i], ['data.json', '{}', /Markdown/], ['binary.md', Buffer.from([255, 254, 0]), /UTF-8/], ['huge.md', Buffer.alloc(256 * 1024 + 1, 65), /256 KiB/]] as const) { const file = join(root, name); await writeFile(file, content); await assert.rejects(loadSkill(file), error); }
});
