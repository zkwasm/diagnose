import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const action = process.argv[2];
if (process.argv.length !== 3 || !['open', 'call', 'close'].includes(action)) {
  console.error('Usage: node scripts/run.mjs open|call|close (JSON on stdin)');
  process.exit(2);
}
const localRuntime = fileURLToPath(new URL('./local-runtime.json', import.meta.url));
function configuredCli() {
  if (existsSync(localRuntime)) {
    const { cli } = JSON.parse(readFileSync(localRuntime, 'utf8'));
    if (typeof cli !== 'string' || !isAbsolute(cli) || !existsSync(cli)) {
      throw new Error('Local Diagnose build is missing. Rebuild the source checkout or install the published Skill.');
    }
    return cli;
  }
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const cli = fileURLToPath(new URL('../../../dist/cli.js', import.meta.url));
    if (manifest.name === '@masstensor/diagnose' && existsSync(cli)) return cli;
  } catch { /* A standalone Skill uses the pinned npm package. */ }
}
const cli = process.env.DIAGNOSE_SKILL_CLI || configuredCli();
const args = cli
  ? [cli, 'skill-session', action]
  : ['--yes', '@masstensor/diagnose@0.8.2', 'skill-session', action];
const command = cli ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, args, {
  stdio: 'inherit',
  // Windows needs cmd.exe for .cmd launchers. The arguments above are fixed.
  shell: !cli && process.platform === 'win32',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
