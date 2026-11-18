import { execFile } from 'node:child_process';
import { lstat, readlink, statfs } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { AtomicTask } from './schema.js';
import { safeText } from './util.js';

const exec = promisify(execFile);
type Arguments = Extract<AtomicTask, { operation: 'system.performance' }>['arguments'];
type ProcessRow = { pid: number; ppid: number; cpuPercent: number; elapsed: string; name: string };
type OpenPaths = { cwd?: string; stdout?: string; stderr?: string };
const windowsCounters = String.raw`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object { '{0} {1} {2} {3}s {4}' -f $_.IDProcess, $_.CreatingProcessID, $_.PercentProcessorTime, $_.ElapsedTime, $_.Name }`;

async function listProcesses(signal: AbortSignal): Promise<ProcessRow[]> {
  const options = { timeout: 12000, maxBuffer: 1024 * 1024, signal, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } };
  const { stdout } = process.platform === 'win32'
    ? await exec(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', windowsCounters], options)
    : await exec('/bin/ps', ['-axo', 'pid=,ppid=,pcpu=,etime=,comm='], options);
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match || Number(match[1]) === 0) return [];
    const cpuPercent = Number(match[3]);
    if (!Number.isFinite(cpuPercent)) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), cpuPercent, elapsed: match[4]!, name: safeText(basename(match[5]!)) }];
  });
}

async function openPaths(pids: number[], signal: AbortSignal): Promise<Map<number, OpenPaths>> {
  const found = new Map<number, OpenPaths>();
  if (!pids.length) return found;
  if (process.platform === 'linux') {
    const link = (path: string) => readlink(path).then(value => isAbsolute(value) ? value : undefined).catch(() => undefined);
    await Promise.all(pids.map(async pid => {
      const [cwd, stdout, stderr] = await Promise.all(['cwd', 'fd/1', 'fd/2'].map(name => link(`/proc/${pid}/${name}`)));
      found.set(pid, { cwd, stdout, stderr });
    }));
  }
  if (process.platform === 'darwin') {
    const stdout = await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', pids.join(','), '-d', 'cwd,1,2', '-F0pfn'], {
      timeout: 3500, maxBuffer: 128 * 1024, signal,
    }).then(result => result.stdout, error => error.code === 1 ? String(error.stdout ?? '') : '');
    let paths: OpenPaths | undefined;
    let field: keyof OpenPaths | undefined;
    for (const record of stdout.split('\0')) {
      const token = record.replace(/^\n/, '');
      if (token[0] === 'p') { paths = {}; found.set(Number(token.slice(1)), paths); field = undefined; }
      else if (token[0] === 'f') field = ({ cwd: 'cwd', '1': 'stdout', '2': 'stderr' } as const)[token.slice(1) as 'cwd' | '1' | '2'];
      else if (token[0] === 'n' && paths && field && isAbsolute(token.slice(1))) paths[field] = token.slice(1);
    }
  }
  return found;
}

async function regularFile(path: string) {
  const info = await lstat(path).catch(() => undefined);
  return info?.isFile() ? info : undefined;
}

export async function inspectPerformance(args: Arguments, signal: AbortSignal) {
  const diskPath = resolve(args.diskPath ?? process.cwd());
  const [rows, volume] = await Promise.all([
    listProcesses(signal).catch(() => undefined),
    statfs(diskPath).catch(() => undefined),
  ]);
  signal.throwIfAborted();
  const processes = rows ?? [];
  const byPid = new Map(processes.map(row => [row.pid, row]));
  const selected = args.pids.length
    ? [...new Set(args.pids)].flatMap(pid => byPid.get(pid) ?? [])
    : processes.sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, args.limit);
  const paths = await openPaths(selected.map(row => row.pid), signal);
  signal.throwIfAborted();
  const explicit = new Set(args.logPaths.map(path => resolve(path)));
  const samples = new Map<string, Set<number>>([...explicit].map(path => [path, new Set<number>()]));
  for (const [pid, details] of paths) {
    for (const path of [details.stdout, details.stderr]) {
      if (!path) continue;
      if (!samples.has(path)) samples.set(path, new Set());
      samples.get(path)!.add(pid);
    }
  }
  const observed = await Promise.all([...samples].map(async ([path, pids]) => ({ path, pids: [...pids], first: await regularFile(path) })));
  const sampleStart = performance.now();
  if (observed.some(file => file.first)) await delay(750, undefined, { signal });
  const logs = await Promise.all(observed.flatMap(({ path, pids, first }) => {
    if (!first && !explicit.has(path)) return [];
    return [regularFile(path).then(last => {
      const common = { path: safeText(path), pids };
      if (!first || !last) return { ...common, state: 'unavailable' };
      if (first.dev !== last.dev || first.ino !== last.ino) return { ...common, state: 'replaced', bytes: last.size };
      const intervalMs = Math.max(1, Math.round(performance.now() - sampleStart));
      return { ...common, state: 'sampled', bytes: last.size, deltaBytes: last.size - first.size, intervalMs };
    })];
  }));
  signal.throwIfAborted();
  return {
    processStatus: rows ? 'sampled' : 'unavailable',
    cpuBasis: process.platform === 'win32' ? 'Windows process counters' : process.platform === 'linux' ? 'Linux ps lifetime average' : 'macOS ps snapshot',
    processes: selected.map(row => {
      const parent = byPid.get(row.ppid), grandparent = parent && byPid.get(parent.ppid);
      const cwd = paths.get(row.pid)?.cwd;
      return { ...row, ...(parent && { parentName: parent.name }), ...(grandparent && { grandparentPid: grandparent.pid, grandparentName: grandparent.name }), ...(cwd && { cwd: safeText(cwd) }) };
    }),
    missingPids: args.pids.filter(pid => !byPid.has(pid)),
    disk: { path: safeText(diskPath), ...(volume ? { availableBytes: volume.bavail * volume.bsize, totalBytes: volume.blocks * volume.bsize } : { state: 'unavailable' }) },
    logs,
  };
}
