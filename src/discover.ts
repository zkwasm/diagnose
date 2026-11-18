import os from 'node:os';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SerialPort } from 'serialport';
export async function inspectSystem(): Promise<Record<string, unknown>> {
  const commands: Record<string, string> = {};
  for (const name of ['node', 'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'python3', 'git', 'curl', 'sudo', 'ssh']) {
    outer: for (const directory of (process.env.PATH ?? '').split(delimiter)) for (const suffix of process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']) {
      const path = join(directory, name + suffix);
      try { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); commands[name] = path; break outer; } catch {}
    }
  }
  const elevated = process.platform === 'win32' ? /S-1-16-(12288|16384)/.test(spawnSync('whoami', ['/groups'], { encoding: 'utf8', timeout: 3000, windowsHide: true }).stdout ?? '') : process.geteuid?.() === 0;
  return { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, hostname: os.hostname(), cwd: process.cwd(), home: os.homedir(), username: os.userInfo().username, elevated, shell: process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL ?? '/bin/sh', commands, serialPorts: await SerialPort.list(), networkInterfaces: os.networkInterfaces(), protocol: 1, version: '0.8.1', capabilities: ['batch', 'script', 'process-stdin', 'pty', 'terminal-resize', 'signals', 'concurrent-jobs', 'encrypted-output-journal', 'resource-resume', 'binary-transfer', 'filesystem', 'local-forward', 'remote-forward', 'socks5'] };
}
