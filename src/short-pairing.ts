import * as opaque from '@serenity-kit/opaque';
import { hkdfSync } from 'node:crypto';

// Registration runs entirely on the probe. The relay sees neither the password,
// registration record nor OPAQUE server setup. Both login roles are endpoints.
await opaque.ready;
const identifiers = (room: string) => ({ client: `diagnose/v2/operator/${room}`, server: `diagnose/v2/probe/${room}` });
const key = (sessionKey: string, room: string) => Buffer.from(hkdfSync('sha256', Buffer.from(sessionKey, 'base64url'), 'diagnose/opaque/v2', `noise-psk/${room}`, 32));
export function pakeMessage(stage: string, value: string): Buffer { return Buffer.from(JSON.stringify({ pake: stage, value })); }
export function pakeValue(bytes: Buffer, expected: string): string {
  if (bytes.length > 4096) throw new Error('Oversized PAKE message');
  const value = JSON.parse(bytes.toString());
  if (value?.pake !== expected || typeof value.value !== 'string' || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(value.value) || Object.keys(value).length !== 2) throw new Error('Invalid PAKE message');
  return value.value;
}
export class InvitationHost {
  private setup: string;
  private record: string;
  private state?: string;
  constructor(private room: string, password: Buffer) {
    this.setup = opaque.server.createSetup();
    const registration = opaque.client.startRegistration({ password: password.toString() });
    const response = opaque.server.createRegistrationResponse({ serverSetup: this.setup, userIdentifier: room, registrationRequest: registration.registrationRequest });
    this.record = opaque.client.finishRegistration({ clientRegistrationState: registration.clientRegistrationState, registrationResponse: response.registrationResponse, password: password.toString(), identifiers: identifiers(room), keyStretching: 'memory-constrained' }).registrationRecord;
  }
  start(bytes: Buffer): Buffer {
    if (this.state) throw new Error('PAKE already started');
    const response = opaque.server.startLogin({ serverSetup: this.setup, registrationRecord: this.record, userIdentifier: this.room, startLoginRequest: pakeValue(bytes, 'start'), identifiers: identifiers(this.room) });
    this.state = response.serverLoginState;
    return pakeMessage('response', response.loginResponse);
  }
  finish(bytes: Buffer): Buffer {
    if (!this.state) throw new Error('PAKE not started');
    const state = this.state; this.state = undefined;
    const response = opaque.server.finishLogin({ serverLoginState: state, finishLoginRequest: pakeValue(bytes, 'finish'), identifiers: identifiers(this.room) });
    return key(response.sessionKey, this.room);
  }
  reset(): void { this.state = undefined; }
  destroy(): void { this.reset(); this.setup = ''; this.record = ''; }
}
export class InvitationJoin {
  private state?: string;
  constructor(private room: string, private password: Buffer) {}
  start(): Buffer {
    if (this.state) throw new Error('PAKE already started');
    const response = opaque.client.startLogin({ password: this.password.toString() }); this.state = response.clientLoginState;
    return pakeMessage('start', response.startLoginRequest);
  }
  finish(bytes: Buffer): { reply: Buffer; secret: Buffer } {
    if (!this.state) throw new Error('PAKE not started');
    const state = this.state; this.state = undefined;
    const response = opaque.client.finishLogin({ clientLoginState: state, password: this.password.toString(), loginResponse: pakeValue(bytes, 'response'), identifiers: identifiers(this.room), keyStretching: 'memory-constrained' });
    if (!response) throw new Error('Incorrect invitation');
    return { reply: pakeMessage('finish', response.finishLoginRequest), secret: key(response.sessionKey, this.room) };
  }
  destroy(): void { this.state = undefined; }
}
