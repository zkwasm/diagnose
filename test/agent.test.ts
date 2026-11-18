import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PairingStore } from '../dist/pairing.js';
import { createCode } from '../dist/crypto.js';
const require = createRequire(import.meta.url);
const cli = realpathSync(process.env.DIAGNOSE_TEST_CLI ?? resolve('dist/cli.js'));

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'diagnose agent test '))), capture = join(root, 'capture.json'), settings = join(root, '.gemini', 'settings.json');
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
let task,taskPath,taskMode;const initial=agent==='gemini'?args[args.indexOf('--prompt-interactive')+1]:args.at(-1);const marker=initial?.split('\\n').find(x=>x.startsWith('Task snapshot path (JSON): ')||x.startsWith('任务快照路径 (JSON): '));if(marker){taskPath=JSON.parse(marker.slice(marker.indexOf(': ')+2));task=JSON.parse(fs.readFileSync(taskPath,'utf8'));taskMode=fs.statSync(taskPath).mode&511;}
const {Client}=await import(${JSON.stringify(client)}),{StdioClientTransport}=await import(${JSON.stringify(transport)});
const client=new Client({name:'launcher-acceptance',version:'1'});await client.connect(new StdioClientTransport(server));const tools=(await client.listTools()).tools.map(t=>t.name);let workflow;
if(process.env.TEST_PAIR_CODE){if(!task?.instructions.includes('STARTUP_WORKFLOW_ACCEPTANCE'))throw Error('Selected task was not read');const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};await call('diagnose_pair',{code:process.env.TEST_PAIR_CODE,label:'Explicitly authorized fixture agent'});const {id}=await call('diagnose_batch',{reason:'Selected startup task: fix and verify scratch configuration',steps:[{operation:'file.write',arguments:{path:process.env.TEST_REMOTE_TARGET,content:'fixed'}},{operation:'file.read',arguments:{path:process.env.TEST_REMOTE_TARGET}}]});workflow=await call('diagnose_wait',{id,timeoutMs:5000,release:true});await call('diagnose_disconnect',{});}
await client.close();
fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args,server,tools,settingsPath,admin,task,taskPath,taskMode,workflow}));if(process.env.TEST_WAIT){process.on('SIGTERM',()=>process.exit(23));setInterval(()=>{},1000)}else process.exit(Number(process.env.TEST_EXIT||0));
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
  assert.equal(captured.server.command, process.execPath); assert.deepEqual(captured.server.args, [cli, 'mcp', 'https://relay.example.test']); assert.equal(captured.tools.length, 15); assert.ok(captured.tools.includes('diagnose_pair')); assert.ok(captured.tools.includes('diagnose_process'));
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

for (const agent of ['codex', 'claude', 'gemini']) test(`agent ${agent} loads the same selected Markdown task at startup without exposing its body in argv`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const f = fixture(), source = join(f.root, 'device "profile".md'), body = '# Device task\nPRIVATE_TASK_MARKER\nRead references/profile.md and diagnose the selected device.\nLiteral $(do-not-execute).'; writeFileSync(source, body);
  new PairingStore(join(f.root, '.diagnose', 'pairings')).add({ role: 'operator', name: 'alice-pc', label: 'test', relay: 'https://relay.example.test', code: createCode() });
  const result = await run(['agent', agent, '--device', 'alice-pc', '--skill', source, '--', '--model', 'selected-model'], { ...process.env, LC_ALL: 'en_US.UTF-8', HOME: f.root, PATH: f.root + ':' + process.env.PATH, GEMINI_CLI_HOME: f.root, TEST_CAPTURE: f.capture });
  assert.equal(result.code, 0, result.output); const captured = JSON.parse(readFileSync(f.capture, 'utf8'));
  assert.deepEqual(captured.server.args.slice(-2), ['--device', 'alice-pc']); assert.match(captured.args.at(-1), /do not ask for a pairing code/);
  assert.equal(captured.task.instructions, body); assert.equal(captured.task.sourceFile, source); assert.equal(captured.task.baseDirectory, f.root); assert.equal(captured.taskMode, 0o600); assert.equal(existsSync(captured.taskPath), false); assert.ok(captured.tools.includes('diagnose_pair'));
  const scopeFlag = agent === 'gemini' ? '--include-directories' : '--add-dir';
  assert.equal(captured.args[captured.args.indexOf(scopeFlag) + 1], dirname(captured.taskPath));
  assert.notEqual(dirname(captured.taskPath), f.root);
  if (captured.settingsPath) assert.ok(!captured.settingsPath.startsWith(dirname(captured.taskPath) + '/'));
  assert.ok(!captured.args.join(' ').includes('PRIVATE_TASK_MARKER')); assert.ok(!result.output.includes('PRIVATE_TASK_MARKER')); assert.ok(captured.args.includes('selected-model'));
  const prompt = captured.args.at(-1); assert.match(prompt, /Start the remote troubleshooting task/); assert.match(prompt, /do not merely summarize/); assert.match(prompt, /approval/);
  if (agent === 'gemini') assert.equal(captured.args.at(-2), '--prompt-interactive'); else assert.equal(captured.args.at(-2), '--');
});

test('Codex receives a Chinese startup prompt while its Markdown task is preserved', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const f = fixture();
  const source = join(f.root, 'device.md'), body = '# Device task\nCheck the attached port. 保留本文。\n';
  writeFileSync(source, body);
  const env = { ...process.env, LC_ALL: 'zh_CN.UTF-8', HOME: f.root, PATH: f.root + ':' + process.env.PATH, TEST_CAPTURE: f.capture };
  const result = await run(['agent', 'codex', '--skill', source], env);
  assert.equal(result.code, 0, result.output);
  const captured = JSON.parse(readFileSync(f.capture, 'utf8'));
  assert.match(captured.args.at(-1), /默认用中文提问和汇报/);
  assert.match(captured.args.at(-1), /通过 diagnose_\* MCP 工具操作现场电脑/);
  assert.equal(captured.task.instructions, body);
  assert.ok(!captured.args.at(-1).includes(body));

  const { Cases } = await import('../dist/cases.js');
  const selected = new Cases(join(f.root, '.diagnose', 'cases')).create({ goal: 'Check device logs', target: { name: 'Gateway', interface: 'serial' } });
  const caseResult = await run(['agent', 'codex', '--case', selected.id], env);
  assert.equal(caseResult.code, 0, caseResult.output);
  assert.match(JSON.parse(readFileSync(f.capture, 'utf8')).task.instructions, /读取所选案例/);
});

test('skill directory is accepted, and invalid skills fail before launching an agent', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const f = fixture(), skill = join(f.root, 'device-skill'); mkdirSync(skill); writeFileSync(join(skill, 'SKILL.md'), '# Device skill\nInspect first.');
  const env = { ...process.env, HOME: f.root, PATH: f.root + ':' + process.env.PATH, GEMINI_CLI_HOME: f.root, TEST_CAPTURE: f.capture };
  const result = await run(['agent', 'codex', '--skill', skill], env); assert.equal(result.code, 0, result.output); assert.equal(JSON.parse(readFileSync(f.capture, 'utf8')).task.sourceFile, join(skill, 'SKILL.md'));
  const missing = await run(['agent', 'codex', '--skill', join(f.root, 'missing.md')], { ...env, TEST_CAPTURE: join(f.root, 'must-not-run') }); assert.equal(missing.code, 1); assert.equal(existsSync(join(f.root, 'must-not-run')), false);
  const conflict = await run(['agent', 'gemini', '--skill', skill, '--', '--prompt', 'another task'], env); assert.equal(conflict.code, 1); assert.match(conflict.output, /initial task/);
});

for (const agent of ['codex', 'claude', 'gemini']) test(`agent ${agent} launches a pinned library bundle through the CLI`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const f = fixture(), source = join(f.root, 'source'); mkdirSync(source); mkdirSync(join(source, 'references'));
  writeFileSync(join(source, 'SKILL.md'), '# Library task\nRead references/profile.md.'); writeFileSync(join(source, 'references/profile.md'), 'Model A');
  const env = { ...process.env, HOME: f.root, PATH: f.root + ':' + process.env.PATH, GEMINI_CLI_HOME: f.root, TEST_CAPTURE: f.capture };
  const imported = await run(['skills', 'import', 'gateway', source], env); assert.equal(imported.code, 0, imported.output);
  const reference = imported.output.trim(); assert.match(reference, /^library:gateway@[a-f0-9]{64}$/);
  const listed = await run(['skills', 'list'], env); assert.deepEqual(JSON.parse(listed.output), [reference]);
  const launched = await run(['agent', agent, '--skill', reference], env); assert.equal(launched.code, 0, launched.output);
  const captured = JSON.parse(readFileSync(f.capture, 'utf8'));
  assert.equal(captured.task.instructions, '# Library task\nRead references/profile.md.');
  assert.equal(readFileSync(join(captured.task.baseDirectory, 'references/profile.md'), 'utf8'), 'Model A');
  assert.ok(captured.task.baseDirectory.includes(reference.split('@')[1]));
});

test('termination also removes the skill snapshot', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const f = fixture(), source = join(f.root, 'task.md'); writeFileSync(source, '# Test task');
  const child = spawn(process.execPath, [cli, 'agent', 'codex', '--skill', source], { env: { ...process.env, HOME: f.root, PATH: f.root + ':' + process.env.PATH, TEST_CAPTURE: f.capture, TEST_WAIT: '1' }, stdio: 'ignore' }); const exit = new Promise<number | null>(resolveExit => child.once('close', resolveExit));
  try { for (let i = 0; i < 100 && !existsSync(f.capture); i++) await new Promise(resolveWait => setTimeout(resolveWait, 20)); assert.ok(existsSync(f.capture)); const captured = JSON.parse(readFileSync(f.capture, 'utf8')); child.kill('SIGTERM'); assert.equal(await exit, 23); assert.equal(existsSync(captured.taskPath), false); }
  finally { child.kill('SIGKILL'); }
});

for (const agent of ['codex', 'claude', 'gemini']) test(`selected startup task reaches a remote repair and verification over real MCP for ${agent}`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const { createRelay } = await import('../dist/relay.js'), { createCode } = await import('../dist/crypto.js'), { Peer } = await import('../dist/peer.js'), { ProbeEngine } = await import('../dist/engine.js'), { Audit } = await import('../dist/util.js');
  const f = fixture(), task = join(f.root, 'repair.md'), target = join(f.root, 'remote-config.txt'); writeFileSync(task, '# STARTUP_WORKFLOW_ACCEPTANCE\nRepair the scratch configuration and read it back to verify.'); writeFileSync(target, 'broken');
  const relay = createRelay({ port: 0 }), url = `ws://127.0.0.1:${await relay.listen()}`, code = createCode(), stages: string[] = [];
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true }); const engine = new ProbeEngine(host, async request => { stages.push(request.stage); return request.task.operation === 'batch.run' && request.task.arguments.steps.every(step => 'path' in step.arguments && step.arguments.path === target); }, new Audit(join(f.root, 'audit.jsonl')), () => {}); await host.open();
  try {
    const result = await run(['agent', agent, '--skill', task, '--relay', url], { ...process.env, HOME: f.root, PATH: f.root + ':' + process.env.PATH, GEMINI_CLI_HOME: f.root, TEST_CAPTURE: f.capture, TEST_PAIR_CODE: code, TEST_REMOTE_TARGET: target });
    assert.equal(result.code, 0, result.output); const captured = JSON.parse(readFileSync(f.capture, 'utf8')); assert.equal(captured.workflow.result.status, 'ok'); assert.equal(captured.workflow.outputs['1.file'], 'fixed'); assert.equal(readFileSync(target, 'utf8'), 'fixed'); assert.deepEqual(stages, ['execute', 'send']); assert.ok(!captured.args.join(' ').includes(code));
  } finally { engine.cancelAll(); host.close(); await relay.close(); }
});

for (const agent of ['codex', 'claude', 'gemini']) test(`agent ${agent} starts the selected case with its pinned skill`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const { Cases } = await import('../dist/cases.js'), { SkillLibrary } = await import('../dist/skill-library.js');
  const f = fixture(), source = join(f.root, 'task.md'); writeFileSync(source, '# Case procedure');
  const reference = await new SkillLibrary(join(f.root, '.diagnose', 'skills')).import('gateway', source);
  const selected = new Cases(join(f.root, '.diagnose', 'cases')).create({ goal: 'Check device logs', target: { name: 'Gateway', interface: 'serial' }, skill: reference });
  const env = { ...process.env, HOME: f.root, PATH: f.root + ':' + process.env.PATH, GEMINI_CLI_HOME: f.root, TEST_CAPTURE: f.capture };
  const result = await run(['agent', agent, '--case', selected.id], env); assert.equal(result.code, 0, result.output);
  const captured = JSON.parse(readFileSync(f.capture, 'utf8')); assert.equal(captured.task.libraryReference, reference); assert.deepEqual(captured.server.args.slice(-2), ['--case', selected.id]);
  const conflict = await run(['agent', agent, '--case', selected.id, '--skill', source], env); assert.equal(conflict.code, 1); assert.match(conflict.output, /revision differs/);
});
