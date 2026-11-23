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
    let ready = 0;
    const captured = await execute(make('serial.capture'), new AbortController().signal, undefined, () => {
      assert.equal(current.isOpen, true);
      ready++;
    });
    assert.equal(ready, 1);
    assert.equal(captured.result.status, 'ok'); assert.equal(current.recording.length, 0); assert.equal(current.isOpen, false);
    assert.equal(captured.outputs[0].bytes.includes(Buffer.from('hidden')), false); assert.ok(captured.outputs[0].bytes.includes(Buffer.from('ready')));
    const exchanged = await execute(make('serial.exchange', { dataHex: '010203ff' }), new AbortController().signal);
    assert.equal(exchanged.result.status, 'ok'); assert.equal(current.recording.toString('hex'), '010203ff'); assert.equal(current.isOpen, false);
    const controller = new AbortController(); const running = execute(make('serial.capture', { durationMs: 5000 }), controller.signal);
    setTimeout(() => controller.abort(), 50); assert.equal((await running).result.status, 'cancelled'); assert.equal(current.isOpen, false);
    await assert.rejects(execute(make('serial.capture', { dataHex: '01' }), new AbortController().signal), /does not accept/);
  } finally { mock.restoreAll(); binding.reset(); }
});

test('read-only capture follows the same USB device when the serial path changes', async () => {
  const binding = SerialPortMock.binding;
  binding.reset();
  binding.createPort('/virtual/first', { readyData: Buffer.from('before\n') });
  binding.createPort('/virtual/second', { readyData: Buffer.from('after\n') });
  const descriptor = { vendorId: '1234', productId: '5678', serialNumber: 'unique-usb-device' };
  const opened: string[] = [];
  const phases: string[] = [];
  let listing = [{ ...descriptor, path: '/virtual/first' }];
  mock.method(SerialPort, 'list', async () => listing);
  mock.method(SerialPort.binding, 'open', (options: Parameters<typeof binding.open>[0]) => binding.open(options));
  const openPort = SerialPort.prototype.open;
  let port: SerialPort;
  mock.method(SerialPort.prototype, 'open', function (this: SerialPort, ...args: Parameters<typeof openPort>) {
    port = this;
    opened.push(this.path);
    return openPort.apply(this, args);
  });
  try {
    const task = taskSchema.parse({ id: randomUUID(), operation: 'serial.capture', arguments: { path: '/virtual/first', durationMs: 1100, reattach: true }, reason: 'Check USB re-enumeration' });
    const result = await execute(task, new AbortController().signal, undefined, phase => {
      phases.push(phase);
      if (phases.length === 1) setTimeout(() => {
        listing = [{ ...descriptor, path: '/virtual/wrong', serialNumber: 'different-device' }, { ...descriptor, path: '/virtual/second' }];
        port.close();
      }, 50);
    });
    assert.equal(result.result.status, 'ok');
    assert.deepEqual(phases, ['serial-ready', 'awaiting-serial-device', 'serial-ready']);
    assert.deepEqual(opened, ['/virtual/first', '/virtual/second']);
    assert.equal(result.outputs[0].bytes.toString(), 'before\nafter\n');
  } finally { mock.restoreAll(); binding.reset(); }
});
