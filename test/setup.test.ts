import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [version, npmPresent, expected] of [['18.20.0', true, 1], ['20.9.0', true, 1], ['20.10.0', true, 0], ['22.18.0', false, 1]] as const) {
  test(`setup preserves existing Node ${version} and user files (npm present: ${npmPresent})`, { skip: process.platform === 'win32' }, () => {
    const root = mkdtempSync(join(tmpdir(), 'diagnose-setup-test-')), home = join(root, 'home'), bin = join(root, 'bin'); mkdirSync(home); mkdirSync(bin);
    writeFileSync(join(bin, 'node'), `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('v${version}');else {Object.defineProperty(process.versions,'node',{value:'${version}'});eval(process.argv[3]);}\n`, { mode: 0o700 });
    if (npmPresent) for (const name of ['npm', 'npx']) writeFileSync(join(bin, name), '#!/bin/sh\necho 10.0.0\n', { mode: 0o700 });
    const result = spawnSync('/bin/bash', [resolve('scripts/setup-node.sh')], { env: { ...process.env, HOME: home, PATH: bin + ':/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr); assert.match(result.stdout, /will NOT be updated/); assert.deepEqual(readdirSync(home), [], 'Existing installations must not create a runtime, environment file, or profile entries');
  });
}
