import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Noise = require('noise-handshake');
const Cipher = require('noise-handshake/cipher.js');
const { generateKeyPair } = require('noise-handshake/dh.js');

// Public cross-implementation fixture, unmodified:
// https://github.com/centromere/cacophony/blob/master/vectors/cacophony.txt
test('published Cacophony NNpsk0/25519/ChaChaPoly/BLAKE2b vector', () => {
  const v = JSON.parse(readFileSync(new URL('./noise-vector.json', import.meta.url), 'utf8'));
  const hex = (value: string) => Buffer.from(value, 'hex');
  const a = new Noise('NNpsk0', true, undefined, { psk: hex(v.init_psks[0]) });
  const b = new Noise('NNpsk0', false, undefined, { psk: hex(v.resp_psks[0]) });
  a.initialise(hex(v.init_prologue)); b.initialise(hex(v.resp_prologue));
  a.e = generateKeyPair(hex(v.init_ephemeral)); b.e = generateKeyPair(hex(v.resp_ephemeral));
  for (let i = 0; i < 2; i++) {
    const sender = i === 0 ? a : b, receiver = i === 0 ? b : a;
    const frame = sender.send(hex(v.messages[i].payload));
    assert.equal(frame.toString('hex'), v.messages[i].ciphertext);
    assert.equal(receiver.recv(frame).toString('hex'), v.messages[i].payload);
  }
  assert.equal(a.hash.toString('hex'), v.handshake_hash); assert.equal(b.hash.toString('hex'), v.handshake_hash);
  const at = new Cipher(a.tx), ar = new Cipher(a.rx), bt = new Cipher(b.tx), br = new Cipher(b.rx);
  for (let i = 2; i < v.messages.length; i++) {
    const sender = i % 2 === 0 ? at : bt, receiver = i % 2 === 0 ? br : ar;
    const frame = sender.encrypt(hex(v.messages[i].payload)); assert.equal(frame.toString('hex'), v.messages[i].ciphertext);
    assert.equal(receiver.decrypt(frame).toString('hex'), v.messages[i].payload);
  }
});
