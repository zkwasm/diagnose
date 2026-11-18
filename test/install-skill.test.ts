import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installs each native Skill, uses the source build outside the project, and preserves existing files', () => {
  const home = mkdtempSync(join(tmpdir(), 'diagnose-install-skill-'));
  const cli = resolve('dist/cli.js');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete (env as NodeJS.ProcessEnv).DIAGNOSE_SKILL_CLI;
  const install = (agent: string) => spawnSync(process.execPath, [cli, 'install-skill', agent], { cwd: home, env, encoding: 'utf8' });
  try {
    for (const [agent, directory] of [['claude', '.claude'], ['codex', '.agents'], ['gemini', '.gemini']]) {
      const result = install(agent);
      assert.equal(result.status, 0, result.stderr);
      const skill = join(home, directory!, 'skills', 'diagnose');
      const nativeSkill = readFileSync('skills/connect/SKILL.md', 'utf8');
      assert.match(nativeSkill, /^name: connect$/m);
      assert.equal(readFileSync(join(skill, 'SKILL.md'), 'utf8'), nativeSkill.replace(/^name: connect$/m, 'name: diagnose'));
      const helper = spawnSync(process.execPath, [join(skill, 'scripts/run.mjs'), 'open'], { cwd: home, env, input: '{}', encoding: 'utf8' });
      assert.equal(helper.status, 1);
      assert.match(helper.stderr, /Supply the one-time pairing code on stdin/);
      const repeated = install(agent);
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.match(repeated.stdout, /already installed/);
    }
    const custom = join(home, '.claude', 'skills', 'diagnose', 'SKILL.md');
    writeFileSync(custom, 'my custom skill');
    const conflict = install('claude');
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /A different Skill already exists/);
    assert.equal(readFileSync(custom, 'utf8'), 'my custom skill');
    assert.equal(install('unknown-agent').status, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
