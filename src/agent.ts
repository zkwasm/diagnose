import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const agentUsage = 'diagnose agent codex|claude|gemini [--relay URL] [-- agent arguments...]';

export async function launchAgent(argv: string[]): Promise<number> {
  const separator = argv.indexOf('--');
  const extra = separator < 0 ? [] : argv.slice(separator + 1);
  const { positionals, values } = parseArgs({ args: separator < 0 ? argv : argv.slice(0, separator), allowPositionals: true, options: { relay: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !positionals.length) { console.log(agentUsage); return 0; }
  const [agent] = positionals;
  if (positionals.length !== 1 || !['codex', 'claude', 'gemini'].includes(agent)) throw new Error(agentUsage);
  if (values.relay) {
    const url = new URL(values.relay);
    if (!['https:', 'wss:'].includes(url.protocol) && !(['http:', 'ws:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Relay requires HTTPS/WSS, except loopback tests');
    if (url.username || url.password) throw new Error('Relay URL must not contain credentials');
  }
  // Reuse this exact installed version. No global install or extra npx download.
  const server = { command: process.execPath, args: [fileURLToPath(new URL('./cli.js', import.meta.url)), 'mcp', ...(values.relay ? [values.relay] : [])] };
  const env = { ...process.env }; let directory: string | undefined;
  try {
    let args: string[];
    if (agent === 'codex') args = ['-c', `mcp_servers.diagnose.command=${JSON.stringify(server.command)}`, '-c', `mcp_servers.diagnose.args=${JSON.stringify(server.args)}`, ...extra];
    else if (agent === 'claude') args = ['--mcp-config', JSON.stringify({ mcpServers: { diagnose: server } }), ...extra];
    else {
      // Gemini has no --mcp-config. Isolate its user settings, retain its real
      // administrator policy and reuse existing login/history through links.
      const originalRoot = resolve(env.GEMINI_CLI_HOME ?? homedir(), '.gemini');
      const original = join(originalRoot, 'settings.json');
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse((await readFile(original, 'utf8')).replace(/^\uFEFF/, '')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read Gemini user settings: ${(error as Error).message}`); }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Gemini user settings must be a JSON object');
      directory = await mkdtemp(join(tmpdir(), 'diagnose-agent-'));
      const configRoot = join(directory, '.gemini'); await mkdir(configRoot, { mode: 0o700 });
      let entries: string[] = [];
      try { entries = await readdir(originalRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const name of entries) if (name !== 'settings.json') await symlink(join(originalRoot, name), join(configRoot, name));
      const path = join(configRoot, 'settings.json');
      await writeFile(path, JSON.stringify({ ...settings, mcpServers: { ...(settings.mcpServers as object ?? {}), diagnose: server } }), { mode: 0o600 });
      env.GEMINI_CLI_HOME = directory; args = extra;
    }
    return await new Promise<number>((resolveExit, reject) => {
      const child = spawn(agent, args, { env, stdio: 'inherit', shell: false });
      const interrupt = () => { child.kill('SIGINT'); }, terminate = () => { child.kill('SIGTERM'); };
      process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
      const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
      child.once('error', error => { cleanup(); reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error(`${agent} was not found on PATH. Install and sign in to its CLI first.`) : error); });
      child.once('close', (code, signal) => { cleanup(); resolveExit(code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)); });
    });
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
