import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SerialPort, SerialPortMock } from 'serialport';
import { execute } from '../dist/executor.js';
import { taskSchema } from '../dist/schema.js';

test('serial capture never transmits; explicit exchange transmits exact bytes and closes', async () => {
  const binding = SerialPortMock.binding; binding.reset();
  binding.createPort('/virtual/diagnose', { echo: true, record: true, readyData: Buffer.from('password=hidden\nready\n') });
  let current: any;
  mock.method(SerialPort.binding, 'open', async options => { current = await binding.open(options); return current; });
  const make = (operation: string, extra = {}) => taskSchema.parse({ id: randomUUID(), operation, arguments: { path: '/virtual/diagnose', durationMs: 100, ...extra }, reason: 'Virtual serial acceptance' });
  try {
    const captured = await execute(make('serial.capture'), new AbortController().signal);
    assert.equal(captured.result.status, 'ok'); assert.equal(current.recording.length, 0); assert.equal(current.isOpen, false);
    assert.equal(captured.outputs[0].bytes.includes(Buffer.from('hidden')), false); assert.ok(captured.outputs[0].bytes.includes(Buffer.from('ready')));
    const exchanged = await execute(make('serial.exchange', { dataHex: '010203ff' }), new AbortController().signal);
    assert.equal(exchanged.result.status, 'ok'); assert.equal(current.recording.toString('hex'), '010203ff'); assert.equal(current.isOpen, false);
    const controller = new AbortController(); const running = execute(make('serial.capture', { durationMs: 5000 }), controller.signal);
    setTimeout(() => controller.abort(), 50); assert.equal((await running).result.status, 'cancelled'); assert.equal(current.isOpen, false);
    await assert.rejects(execute(make('serial.capture', { dataHex: '01' }), new AbortController().signal), /does not accept/);
  } finally { mock.restoreAll(); binding.reset(); }
});
