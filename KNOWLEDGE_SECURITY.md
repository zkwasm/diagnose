# Personal knowledge library security and operations

## Scope and threat model

Remote device sessions retain the existing Noise protocol and user-controlled permissions. The knowledge library is separate: a person holding its recovery credential can retrieve, publish and revoke that person's library. It is not an account, proof of identity, team role system or device pairing credential.

The relay is trusted for availability, storage quotas and revocation, but not with skill plaintext. It sees source IPs, request times, ciphertext sizes, the number of objects, an opaque stable namespace, and stable object identifiers. The AI provider can see instructions and evidence supplied to the agent. Local files and recovery credentials are accessible to the same OS user; this is not a sandbox against a malicious local process.

## Cryptographic format v1

- Recovery credential: `K1.` followed by 32 random bytes encoded as canonical base64url. Never a password or a probe pairing code.
- HKDF-SHA-256 with salt `diagnose-library-v1` and distinct info strings `authentication`, `encryption`, and `object-names` derives independent 32-byte keys.
- The authentication key is sent as an HTTPS Bearer capability. The storage namespace is SHA-256 of its base64url text. The server cannot derive the encryption key from this capability.
- Object names are HMAC-SHA-256 of the complete pinned library reference using the object-name key. Names and paths are not sent in plaintext.
- A bundle is encrypted with AES-256-GCM, a fresh random 12-byte nonce and a 16-byte tag. AAD is `diagnose-library-v1:NAMESPACE:OBJECT_ID`. Wire layout is one version byte (`1`), nonce, ciphertext, tag.
- Decrypted JSON contains the reference and the complete file bundle. Clients validate the object HMAC, portable paths, file/size limits and the content digest before importing. Encryption covers provenance as well as instructions and resources. Downloads never execute anything.

Objects are immutable. Concurrent different revisions have different identifiers and are retained. There is no remote mutable “latest” pointer, so no overwrite or head compare-and-swap is needed. A concurrent duplicate upload can return 409; rerun the explicit push to verify the stored plaintext matches. No modifying diagnostic command is replayed as a consequence of sync.

A malicious relay can omit or replay a previously valid object or deny service. It cannot forge new plaintext under the key. This version does not provide cryptographic proof of inventory completeness or freshness on a newly restored computer. Local cached versions are never removed by pull. Permission bits are not part of portable content identity; restored files are private non-executable files and scripts can be run explicitly through an interpreter after review.

## Review boundary

The agent can propose drafts and cite locally recorded evidence. There is no MCP tool to accept drafts, reveal recovery keys or upload skills. CLI acceptance displays the exact proposed entry and evidence references and requires an interactive confirmation. CLI push separately confirms publishing the complete bundle. Base references/scripts are preserved, not regenerated silently.

This separation is a workflow guard, not an OS security boundary: an agent allowed unrestricted local shell access can read or modify the diagnostician's files. Continue to use the agent's own permissions. Treat captured output as untrusted data. Automated redaction is best effort; review addresses, identifiers, credentials and customer details before accepting or sharing. Do not place raw logs in skill directories.

## Local retention

- Cases: encrypted metadata with a same-user local key; at most 100 cases, 200 evidence records each. Each record retains at most 32 KiB of sanitized JSON (larger values retain a preview and digest). Limit exhaustion is surfaced; no claim of complete evidence is made. Remove cases explicitly after exporting a reviewed summary.
- Drafts: at most 100 encrypted draft records. Accepted/rejected records can be removed without removing imported versions.
- Skills: local private plaintext source bundles. No automatic deletion. Every directory import includes all regular files within the declared limits.
- Recovery credential: private local file at `~/.diagnose/vault/recovery`. Backups use exclusive file creation and private permissions where supported. Never include a recovery key in a prompt, argv, issue or report.

## Relay operations

Set `VAULT_PATH` to persistent storage outside release directories. Run one relay process, not multiple workers sharing this filesystem. Route `/v1/library` and `/v1/library/*` through the existing HTTPS proxy. Do not log Authorization headers. Current limits: 12 MiB per encrypted object, 128 objects and 128 MiB per library, 1 GiB total, 1,000 namespaces including revocation tombstones, two concurrent uploads, 600 requests per IP per minute, 30-second upload inactivity timeout. Hosting a public capability store still requires monitoring for abuse; quotas bound this implementation's storage use.

A write is staged and atomically renamed only after the full declared body arrives and quotas are rechecked. Unpublished staging files are removed on startup. Per-object writes are flushed before publication. Keep the host disk backed by a reliable filesystem; atomic publication does not promise survival of every filesystem or power failure.

No automatic server backups are created by the application. Local verified skills plus an offline recovery backup are the user's recovery path. Operators may back up the ciphertext store and tombstones, using encrypted snapshots with an explicit retention policy. Restoring an older server backup can resurrect deleted ciphertext and lose recent revocations; preserve and reconcile tombstones before restoring service. Do not promise deletion from external backups the application cannot control.

`vault revoke` deletes the current server library and persists a tombstone for that capability. It revokes all computers using that credential on that relay. It cannot erase previously downloaded plaintext or ciphertext. For rotation: pull/cache wanted versions first, revoke, forget the local credential, initialize a new credential and backup, then explicitly push chosen versions and restore the new credential on trusted computers. A lost or exposed credential cannot be repaired by changing a device pairing code. Losing all recovery copies loses decryption access to server-only versions.

## Validation

Tests cover real stdio MCP case recording and draft proposal; base preservation and conflicts; independent clients; wrong keys and AAD; ciphertext tampering; invalid bundle paths; immutable writes; unauthenticated access; revocation; offline cached use; quota/partial-request behavior. Cryptography uses Node's standard primitives; this is not a claim of an independent security audit.
