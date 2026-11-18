# Troubleshoot and review a session

Use this guide when setup, a connection, or a task fails, or when you want to check what happened afterward.

[All guide scenarios](../../USER_GUIDE.md)

## Troubleshooting

- **Agent CLI not found:** install and sign in to that CLI separately, and ensure it is on `PATH`.
- **No Diagnose tools:** invoke the [native skill](diagnose.md#use-diagnose-as-a-native-agent-skill) in an agent session with the plugin installed, or [launch an agent with Diagnose MCP](automation.md#launch-an-agent-with-diagnose-mcp).
- **Invitation expired or connection refused:** keep the probe open and use its latest complete code; the probe may require local approval.
- **Gemini trust or account error:** complete its normal workspace trust and authentication flow. Diagnose does not bypass these checks.
- **Resource not attached:** request `diagnose_resume` after the new pairing, with the original ID and recovery credential.
- **Upload/download hash mismatch:** do not replace the destination. Confirm the source has not changed and inspect transfer status before retrying.
- **Missing serial device:** verify the cable carries data, check OS drivers and permissions, and list ports again. Opening a port may reset the device.

## Disconnect and recover

When a connection drops, finite jobs are cancelled and serial handles close. With a remembered pairing, the probe stays available and the next new MCP operation reconnects without another code. For temporary sessions, the probe displays a new code and requires local connection consent again. Resume retained resources explicitly using their original IDs and recovery credentials. Diagnose never silently replays a creation command.

Ordinary live processes default to `retainOnDisconnect:false`; file transfers default to retained. A retained live process survives network loss only while the original probe process remains running. If the probe itself disappears, a new probe can recover encrypted saved output and supported file staging, but cannot take over the old process's PTY. Network connections must be recreated.

For download resume, keep the partial file and sidecar together. Upload resume uses the resource ID and recovery credential reported in progress. If a response is lost during a modifying action, inspect resource status before retrying; do not blindly restart the command.

## Security and local data

Remembered pairing credentials and policy are stored encrypted under `~/.diagnose/pairings`, with a local key in that protected directory (directory `0700`, files `0600` where supported). This protects stored contents from casual access, not a compromised OS account or a backup containing both ciphertext and key. Possession of a relationship credential authenticates that relationship, not a person’s legal identity. Revocation removes the user-side credential and terminates access. Stable relay routing identifiers can correlate repeated connections; the relay still sees connection metadata.


Short invitations use OPAQUE between the two endpoints to derive a strong Noise PSK. Only a two-letter locator reaches the relay; the other seven random letters remain the PAKE secret. The probe itself enforces expiry and attempt limits. Remembered relationships and legacy D1 invitations use independent random 256-bit secrets. The transport uses Noise `NNpsk0_25519_ChaChaPoly_BLAKE2b`, ephemeral X25519 keys, independent direction counters, and routing/role/version binding. See the [short invitation protocol](https://github.com/zkwasm/diagnose/blob/main/PAIRING_PROTOCOL.md) for the exact design and limits. Tests include a public Cacophony test vector. Each direction is limited to one million frames, below the dependency's 32-bit counter boundary. WSS also validates the relay certificate. No independent security audit has been completed.

The relay keeps rooms and ciphertext buffers in memory. It does not persist diagnostic contents, endpoint decryption keys, or offline messages. It can see IP addresses, routing identifiers, connection timing, and traffic volume, and can deny service. A self-reported label is not verified identity.

The diagnostician, their endpoint software, and their AI provider can see results. Do not share a code or approve a session with someone you do not intend to trust.

### Audit logs

`~/.diagnose/audit-*.jsonl` uses mode `0600`. Events record task IDs, operation types, target paths/executables/interpreters, ranges and serial settings, argument digests, decisions, collection/transmission byte counts, cancellations, and outcomes. Batch steps include their parent task and individual status. Automatic mode records its permission changes and automatic approvals.

Built-in file mutations record paths and, where available, before/after hashes and byte counts. JSONL audit logs contain metadata only; the separate encrypted history below stores full tasks and finite collected results. Neither is a filesystem monitor: arbitrary programs can change files, services, and devices outside the built-in operations. Audit writes are flushed; an unwritable audit log stops the affected operation. Metadata logs rotate at 8 MiB; inactive archives are pruned after seven days or when their aggregate budget exceeds 32 MiB.

### Review local history and clean up

Available in **0.5.0+** on the computer receiving help:

```sh
diagnose history
diagnose show TASK_ID
diagnose show RESOURCE_ID --cursor 0
diagnose cleanup
# Remove all inactive local history and resources now:
diagnose cleanup --days 0
```

History records exact requested commands or scripts, approval previews, decisions, finite collected results (including results the user declined to send), attempted transfers, and known built-in changes. A completed send records that the local transport accepted it, not proof that a human read it. Continuous process output is stored in the resource journal; `show` returns a page with a cursor for the next page. Remote process input is recorded locally; hidden input entered with `secret` records only its byte count. Raw tunnel traffic and exact transferred file bodies are not duplicated in task history; their scope, paths, hashes, and traffic counts are recorded. Arbitrary script side effects and automatic rollback are not provided.

Full history can contain sensitive data, even if results were never sent. It is encrypted locally in `~/.diagnose/history`, with the key beside it under the same user account. This protects against casual file inspection, not someone controlling that account. History is not automatically uploaded and has no dedicated remote MCP tool. An authorized remote command still has your OS account's file access.

History and resource journals each have a **256 MiB / 2,000-record** budget. Inactive records expire after **seven days** and may be evicted sooner to stay within budget. Maintenance runs when storage is used and when `cleanup` is requested. Live retained resources are protected; if they exhaust the budget, collection stops rather than growing without bound. Close unused jobs before cleaning up. Abandoned upload staging files are removed with expired resource records; destination files and remembered pairings are never deleted by cleanup. Upload staging bytes are separate from the journal budget and consume space beside the destination.

Both endpoints at 0.5.0+ use increasing task sequence numbers, so a connection can run more than 1,000 tasks while rejecting replayed sequences. The diagnostician retains at most 128 task results and 32 MiB in memory; save needed results or use local history before they expire. Older clients retain the 1,000-task limit and require an explicit reconnect. Neither path automatically repeats a modifying command.

### Saved output and recovery data

Raw live output and recovery metadata are stored under `~/.diagnose/resources` using AES-256-GCM records. The local key has mode `0600` in the same account's directory. This protects stored ciphertext from casual inspection, not an attacker who controls that OS account and can read the key. Inactive saved output follows the resource journal retention limits above. Use `diagnose cleanup` to remove eligible records on demand.

Finite text results receive best-effort common-credential redaction and terminal-control filtering. Regexes cannot identify every secret. Live terminals, exact file transfers, and TCP channels retain raw data and are not redacted. Collection and transmission are audited separately.

Commands run with the current user's OS permissions. Diagnose neither provides a sandbox nor automatically elevates privileges. It cannot completely observe arbitrary process side effects, undo completed modifications, or isolate against hostile local concurrent changes.

## Source, hosting, and video

[Source and issues](https://github.com/zkwasm/diagnose) · [npm package](https://www.npmjs.com/package/@masstensor/diagnose)

The public relay is hosted at `diagnose.fenginwind.com`. You can self-host using the deployment templates in the repository. Keep local credentials, hardware logs, firmware, and resource journals out of server deployments and public packages.

The [one-minute English walkthrough](https://diagnose.fenginwind.com/#walkthrough) covers the current agent launcher, local permissions, encrypted transport, investigation, authorized repair, and verification. It includes English narration and captions. The port-mismatch repair is an illustrative example, not a live diagnosis. The earlier Chinese video is retained separately.
