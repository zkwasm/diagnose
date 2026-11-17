import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRelay } from '../dist/relay.js';
import { createCode } from '../dist/crypto.js';
import { Peer } from '../dist/peer.js';
import { ProbeEngine } from '../dist/engine.js';
import { Audit } from '../dist/util.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('real stdio MCP client pairs, starts, waits and disconnects', async () => {
  const relay = createRelay({ port: 0 }); const url = `ws://127.0.0.1:${await relay.listen()}`;
  const code = createCode(); const host = new Peer({ role: 'host', code, relay: url, accept: async () => true });
  new ProbeEngine(host, async () => true, new Audit(join(mkdtempSync(join(tmpdir(), 'diagnose-mcp-')), 'audit.jsonl'))); await host.open();
  const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.DIAGNOSE_TEST_CLI ?? resolve('dist/cli.js'), 'mcp', url], stderr: 'pipe' });
  const client = new Client({ name: 'acceptance', version: '1.0.0' });
  const text = (result: any) => { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
  try {
    await client.connect(transport); assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['diagnose_batch', 'diagnose_cancel', 'diagnose_disconnect', 'diagnose_forward', 'diagnose_pair', 'diagnose_process', 'diagnose_resource', 'diagnose_resume', 'diagnose_start', 'diagnose_transfer', 'diagnose_wait']);
    assert.equal(text(await client.callTool({ name: 'diagnose_pair', arguments: { code, label: 'MCP test' } })).connected, true);
    const { id } = text(await client.callTool({ name: 'diagnose_start', arguments: { operation: 'system.inspect', arguments: {}, reason: 'Verify MCP execution' } }));
    const result = text(await client.callTool({ name: 'diagnose_wait', arguments: { id, timeoutMs: 5000, release: true } }));
    assert.equal(result.result.status, 'ok'); assert.equal(result.result.data.platform, process.platform);
    const plan = text(await client.callTool({ name: 'diagnose_batch', arguments: { reason: 'Verify MCP batch and script', steps: [{ operation: 'system.inspect', arguments: {} }, { operation: 'process.script', arguments: { interpreter: process.execPath, script: 'console.log("MCP batch script")' } }] } }));
    const combined = text(await client.callTool({ name: 'diagnose_wait', arguments: { id: plan.id, timeoutMs: 5000, release: true } }));
    assert.equal(combined.result.status, 'ok'); assert.equal(combined.result.data.completedSteps, 2); assert.equal(combined.outputs['1.stdout'], 'MCP batch script\n');
    const liveTask = text(await client.callTool({ name: 'diagnose_process', arguments: { executable: process.execPath, args: ['-e', 'console.log("MCP_READY");process.stdin.on("data",x=>console.log("MCP_INPUT="+x.toString()));'], reason: 'Verify live input and output' } }));
    const descriptor = text(await client.callTool({ name: 'diagnose_wait', arguments: { id: liveTask.id, timeoutMs: 5000 } })).result.data;
    let cursor = 0, liveText = '';
    for (let i = 0; i < 30 && !liveText.includes('MCP_READY'); i++) { const output = text(await client.callTool({ name: 'diagnose_resource', arguments: { id: descriptor.id, action: 'read', cursor, textOutput: true } })); cursor = output.cursor; liveText += output.records.map((entry: any) => entry.text).join(''); }
    assert.ok(liveText.includes('MCP_READY'));
    text(await client.callTool({ name: 'diagnose_resource', arguments: { id: descriptor.id, action: 'input', text: 'interactive\n' } }));
    for (let i = 0; i < 30 && !liveText.includes('MCP_INPUT=interactive'); i++) { const output = text(await client.callTool({ name: 'diagnose_resource', arguments: { id: descriptor.id, action: 'read', cursor, textOutput: true } })); cursor = output.cursor; liveText += output.records.map((entry: any) => entry.text).join(''); }
    assert.ok(liveText.includes('MCP_INPUT=interactive'));
    text(await client.callTool({ name: 'diagnose_resource', arguments: { id: descriptor.id, action: 'close' } }));
    assert.equal(text(await client.callTool({ name: 'diagnose_disconnect', arguments: {} })).disconnected, true);
  } finally { await client.close(); host.close(); await relay.close(); }
});
