import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Pass an empty runtime staging directory.');
const destination = resolve(process.argv[2]);
if (existsSync(join(destination, 'node_modules'))) throw new Error('Use a fresh staging directory.');
mkdirSync(destination, { recursive: true });
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
for (const path of ['dist', 'package.json', 'npm-shrinkwrap.json', 'LICENSE']) {
  cpSync(join(root, path), join(destination, path), { recursive: true });
}
copyFileSync(join(root, 'desktop', 'labels.json'), join(destination, 'labels.json'));
copyFileSync(process.execPath, join(destination, 'node'));
chmodSync(join(destination, 'node'), 0o755);
const runtimeRoot = dirname(dirname(process.execPath));
const license = process.env.DIAGNOSE_NODE_LICENSE || [join(runtimeRoot, 'LICENSE'), join(runtimeRoot, 'share', 'doc', 'nodejs', 'copyright')].find(existsSync);
if (!license) throw new Error('Set DIAGNOSE_NODE_LICENSE to the LICENSE for the bundled Node.js distribution.');
copyFileSync(license, join(destination, 'NODE-LICENSE.txt'));
execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: destination, stdio: 'inherit' });
for (const name of ['node-pty', 'sodium-native', 'bare-inspect', 'bare-type', '@serialport/bindings-cpp']) {
  const prebuilds = join(destination, 'node_modules', name, 'prebuilds');
  if (!existsSync(prebuilds)) continue;
  for (const entry of readdirSync(prebuilds, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const [platform, architectures] = entry.name.split('-');
    if (platform !== process.platform || !architectures?.split('+').includes(process.arch)) {
      rmSync(join(prebuilds, entry.name), { recursive: true });
    }
  }
}
execFileSync(join(destination, 'node'), [join(destination, 'dist', 'cli.js'), 'help'], { cwd: destination, stdio: 'inherit' });
