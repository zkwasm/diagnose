import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRelay } from '../dist/relay.js';
import { createCode } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Audit } from '../dist/util.js';

test('real MCP case records received tasks, reports verification and proposes an unaccepted skill', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diagnose-case-mcp-')); t.after(() => rm(root, { recursive: true, force: true }));
  const relay = createRelay({ port: 0 }), url = 'ws://127.0.0.1:' + await relay.listen(), code = createCode();
  const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  new ProbeEngine(host, async request => request.task.operation === 'system.inspect', new Audit(join(root, 'audit.jsonl'))); await host.open();
  const client = new Client({ name: 'knowledge-workflow', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp', url], env: { ...process.env, HOME: root, USERPROFILE: root } as Record<string, string>, stderr: 'pipe' });
  const call = async (name: string, args: Record<string, unknown>) => { const value = await client.callTool({ name, arguments: args }); assert.ok(!value.isError, JSON.stringify(value)); return JSON.parse((value.content as { text: string }[])[0].text); };
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map(item => item.name); assert.ok(!names.some(name => name.includes('accept') || name.includes('vault')));
    const capabilities = await call('diagnose_capabilities', { operation: 'serial.capture' }); assert.ok(capabilities.operations[0].arguments.properties.baudRate);
    const selected = await call('diagnose_case', { action: 'create', input: { goal: 'Verify interface inspection', host: 'workshop-laptop', target: { name: 'Gateway', model: 'SEG-X3-C', interface: 'serial' } } });
    await call('diagnose_pair', { code, label: 'Acceptance test' });
    for (let i = 0; i < 2; i++) { const task = await call('diagnose_start', { operation: 'system.inspect', arguments: {}, reason: 'Read-only interface inventory' }); const result = await call('diagnose_wait', { id: task.id, timeoutMs: 5000 }); assert.equal(result.result.status, 'ok'); }
    const snapshot = await call('diagnose_case', { action: 'show' }), results = snapshot.case.evidence.filter((item: { kind: string }) => item.kind === 'task.result');
    assert.equal(results.length, 2); assert.ok(!('data' in results[0]));
    const status = await call('diagnose_case', { action: 'status' }); assert.equal(status.probe, 'connected'); assert.equal(status.target.model, 'SEG-X3-C');
    const report = await call('diagnose_case', { action: 'finish', conclusion: { outcome: 'resolved', summary: 'Interface inspection works; device functionality not tested', baseline: results[0].id, verification: results[1].id } }); assert.equal(report.report.conclusion.outcome, 'resolved');
    const draft = await call('diagnose_skill_draft', { name: 'interface-check', caseId: selected.case.id, evidence: [results[0].id], title: 'Inspect gateway interfaces', applicability: 'Gateway attached to an on-site host', prerequisites: 'User consent', identityChecks: 'Confirm model and serial number', readOnlyChecks: 'Use system.inspect; do not scan or open ports automatically', repairConditions: 'No repair authorized by this procedure', recovery: 'Stop if identity differs', verification: 'Confirm selected interface is listed', failedApproaches: 'An interface listing does not verify gateway health' });
    assert.equal(draft.state, 'pending'); assert.deepEqual((await call('diagnose_skills', {})).references, []);
    await call('diagnose_disconnect', {});
  } finally { await client.close(); host.close(); await relay.close(); }
});
