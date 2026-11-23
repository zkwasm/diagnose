# Short invitation protocol (Diagnose 0.7)

## User experience

New invitations are nine uniformly random English letters, displayed as `abc-def-ghi`. Input ignores case, whitespace and hyphens. Starting in 0.8.4, the probe and relay expire them after two hours, including time spent awaiting local confirmation. Successful pairing consumes the invitation. Declining, reaching the attempt limit, or ending the probe also invalidates it. A running probe generates a new invitation when the old one ends.

Remembered pairing still exchanges an independent 256-bit random `D1` credential inside the approved encrypted session. It is stored privately and is not spoken or manually entered. Existing remembered credentials work unchanged. Knowledge-library `K1` recovery credentials are unrelated and unchanged.

## Routing and authentication

The first two letters form a public locator: relay room `S2.ab`. The remaining seven letters are the PAKE password, with approximately 32.9 bits of entropy. The total nine-letter string has approximately 42.3 bits, but the public locator is **not** counted as authentication entropy. There are 676 locator slots; the current relay allows at most 100 active rooms. A collision is rejected without replacing the first host, and the CLI generates a fresh invitation before showing it.

The complete code, password, or a publicly testable hash of them is never sent to the relay. Publishing a hash of all nine letters as the routing identifier would create an offline password-checking oracle and is deliberately avoided.

The probe enforces at most five attempted handshakes per invitation, even if the relay ignores its own limits. The relay also enforces five attempts, two-hour expiry, concurrent connection limits and 60 new connections per IP per minute. Wrong passwords cannot reach the local approval prompt. These limits bound online guessing; they cannot guarantee availability against a malicious relay. A holder of the complete code can request access, but still needs local user approval. A supplied name is not verified identity.

## Cryptographic flow

1. The probe creates fresh OPAQUE server setup and a password registration record entirely in its own memory. No registration messages or verifier are published. A new setup is generated for each invitation.
2. The diagnostician endpoint initiates OPAQUE login; the relay forwards binary start, response and finish messages. Both roles bind `diagnose/v2/operator/ROOM` and `diagnose/v2/probe/ROOM` identifiers.
3. Both derive a 32-byte Noise PSK with HKDF-SHA-256 from the OPAQUE session key, salt `diagnose/opaque/v2`, info `noise-psk/ROOM`.
4. The existing `Noise_NNpsk0_25519_ChaChaPoly_BLAKE2b` exchange runs with that PSK. Its prologue includes the room, roles and protocol. Labels are sent inside Noise, after PAKE.
5. Once the probe has local consent, it locks the invitation and sends the existing encrypted acceptance message. **Approve everything** can supply that consent in advance for one temporary invitation. Remembered credentials still require confirmation and are sent only inside the accepted encrypted channel. A temporary session starts a six-hour idle clock at activation. Diagnostic messages and explicit result polls renew it. Automatic heartbeats do not. The updated relay renews its room on encrypted traffic as it cannot distinguish diagnostics from heartbeats. The probe enforces the actual idle timeout. An explicit total time limit, when configured, still applies.

Implementation: pinned `@serenity-kit/opaque` 1.1.0, using its default memory-constrained Argon2id configuration, plus the existing pinned Noise implementation. OPAQUE protocol implementation and parameters are not reimplemented here. Sources: [library and implementation details](https://github.com/serenity-kit/opaque), [OPAQUE specification](https://www.rfc-editor.org/rfc/rfc9807.html). The upstream library has undergone a public security review; this integration has not received an independent audit. Secret Buffers are cleared where possible and obsolete OPAQUE state references are discarded; JavaScript/WASM does not guarantee erasure of every memory copy.

## Wire compatibility and bounds

The WebSocket endpoint remains `/v1/connect`. Registration version 2 accepts only `S2.` plus two lowercase letters. Version 1 accepts the existing 16-character room IDs. The formats cannot negotiate or silently downgrade between mechanisms. New clients accept old `D1` invitations; old clients cannot use new short invitations. Upgrade both endpoints and the relay for the short-code flow.

OPAQUE messages are strict JSON binary frames with exactly `pake` and `value` fields. Stage values are `start`, `response`, `finish`; each frame is bounded to 4 KiB and the encoded value to 2,048 characters. Stage ordering is enforced. The join endpoint accepts one relay join notification, preventing repeated password trials against one client handshake. The probe keeps a local invitation deadline and attempt counter independent from relay state. After OPAQUE completes, the existing Noise framing, counters, approval and resource authorization remain in force.

The relay can see locators, opaque handshake transcripts, source IPs, timing and traffic sizes. It can interrupt service or send misleading control messages, but those messages do not disable endpoint expiry/attempt limits or authorize commands. Session transport continues to require TLS for non-loopback relays.

## Validation

Tests cover normalization, malformed inputs, wrong passwords and locator binding, successful key agreement, no approval before authentication, hidden long credential provisioning, one-time use, endpoint and relay expiry, malicious relay reset attempts, locator collisions and session timer ordering. Existing Noise vector, execution approval, persistent pairing and resource-recovery regressions remain required. The nine-letter examples in documentation are placeholders, never production credentials.
