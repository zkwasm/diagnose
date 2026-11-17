import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const cli = resolve('dist/cli.js');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'diagnose agent test ')), capture = join(root, 'capture.json'), settings = join(root, '.gemini', 'settings.json');
  mkdirSync(join(root, '.gemini'));
  writeFileSync(settings, JSON.stringify({ security: { marker: 'preserve-admin-policy' }, mcpServers: { existing: { command: 'unchanged' } } }));
  for (const name of ['.codex', '.claude', '.gemini']) { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, 'sentinel'), 'unchanged'); }
  const client = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href, transport = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href;
  const stub = `#!${process.execPath}
(async()=>{
const fs=require('node:fs'), args=process.argv.slice(2), agent=require('node:path').basename(process.argv[1]);let server,settingsPath,admin;
if(agent==='codex'){const overrides=args.filter((_,i)=>args[i-1]==='-c');server={command:JSON.parse(overrides[0].split('=').slice(1).join('=')),args:JSON.parse(overrides[1].split('=').slice(1).join('='))};}
else if(agent==='claude')server=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.diagnose;
else{settingsPath=require('node:path').join(process.env.GEMINI_CLI_HOME,'.gemini','settings.json');const settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));server=settings.mcpServers.diagnose;admin=settings.security; if(settings.mcpServers.existing.command!=='unchanged')throw Error('Existing MCP lost');}
const {Client}=await import(${JSON.stringify(client)}),{StdioClientTransport}=await import(${JSON.stringify(transport)});
const client=new Client({name:'launcher-acceptance',version:'1'});await client.connect(new StdioClientTransport(server));const tools=(await client.listTools()).tools.map(t=>t.name);await client.close();
fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args,server,tools,settingsPath,admin}));if(process.env.TEST_WAIT){process.on('SIGTERM',()=>process.exit(23));setInterval(()=>{},1000)}else process.exit(Number(process.env.TEST_EXIT||0));
})().catch(e=>{console.error(e);process.exit(99)});
`;
  for (const agent of ['codex', 'claude', 'gemini']) writeFileSync(join(root, agent), stub, { mode: 0o700 });
  return { root, capture, settings };
}
function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveExit, reject) => { const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x); child.on('error', reject); child.on('close', code => resolveExit({ code, output })); });
}
for (const agent of ['codex', 'claude', 'gemini']) test(`agent ${agent} loads real MCP tools for this launch without modifying global configuration`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const f = fixture(), before = readFileSync(f.settings, 'utf8');
  const result = await run(['agent', agent, '--relay', 'https://relay.example.test', '--', '--model', 'a model with spaces', 'literal $(do-not-execute)'], { ...process.env, HOME: f.root, PATH: f.root + ':' + process.env.PATH, GEMINI_CLI_HOME: f.root, TEST_CAPTURE: f.capture, TEST_EXIT: '7' });
  assert.equal(result.code, 7, result.output); const captured = JSON.parse(readFileSync(f.capture, 'utf8'));
  assert.equal(captured.server.command, process.execPath); assert.deepEqual(captured.server.args, [cli, 'mcp', 'https://relay.example.test']); assert.equal(captured.tools.length, 11); assert.ok(captured.tools.includes('diagnose_pair')); assert.ok(captured.tools.includes('diagnose_process'));
  assert.deepEqual(captured.args.slice(-3), ['--model', 'a model with spaces', 'literal $(do-not-execute)']);
  assert.equal(readFileSync(f.settings, 'utf8'), before); for (const name of ['.codex', '.claude', '.gemini']) assert.equal(readFileSync(join(f.root, name, 'sentinel'), 'utf8'), 'unchanged');
  if (agent === 'gemini') { assert.equal(captured.admin.marker, 'preserve-admin-policy'); assert.equal(existsSync(captured.settingsPath), false); }
});

test('agent launcher validates inputs and reports missing CLI without installing it', async () => {
  assert.match((await run(['agent', 'unknown'], process.env)).output, /codex\|claude\|gemini/);
  const insecure = await run(['agent', 'codex', '--relay', 'http://example.com'], process.env); assert.equal(insecure.code, 1); assert.match(insecure.output, /HTTPS/);
  const root = mkdtempSync(join(tmpdir(), 'diagnose-no-cli-')); const missing = await run(['agent', 'codex'], { ...process.env, PATH: root }); assert.equal(missing.code, 1); assert.match(missing.output, /not found on PATH/);
});


test('agent forwards termination and cleans the Gemini overlay', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const f = fixture(); const child = spawn(process.execPath, [cli, 'agent', 'gemini'], { env: { ...process.env, HOME: f.root, GEMINI_CLI_HOME: f.root, PATH: f.root + ':' + process.env.PATH, TEST_CAPTURE: f.capture, TEST_WAIT: '1' }, stdio: 'ignore' });
  const exit = new Promise<number | null>(resolveExit => child.once('close', resolveExit));
  try { for (let i = 0; i < 100 && !existsSync(f.capture); i++) await new Promise(resolveWait => setTimeout(resolveWait, 20)); assert.ok(existsSync(f.capture)); const captured = JSON.parse(readFileSync(f.capture, 'utf8')); child.kill('SIGTERM'); assert.equal(await exit, 23); assert.equal(existsSync(captured.settingsPath), false); assert.ok(existsSync(f.settings)); }
  finally { child.kill('SIGKILL'); }
});
