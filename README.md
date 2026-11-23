# Diagnose

**Diagnose and fix problems remotely with your AI agent.**

Diagnose is an open-source tool for agent-led remote troubleshooting and problem resolution. It gives Codex, Claude Code, Gemini CLI, or another MCP client the remote tools to investigate gateways, controllers and other devices reachable from an on-site computer, apply authorized fixes, and verify the result. A user-controlled probe and an end-to-end encrypted relay provide the connection. Launch with a reusable Markdown diagnostic skill to start the investigation automatically. The agent uses the procedure and the evidence it collects to decide what to check next.

[Quick start](USER_GUIDE.md#quick-start) · [Diagnostic walkthroughs](docs/guide/examples.md) · [npm](https://www.npmjs.com/package/@masstensor/diagnose) · [Website](https://diagnose.fenginwind.com)

Requires **Node.js 20.10+**. MIT licensed. TypeScript source is included in the npm package. macOS probes and the Linux relay have been tested. CI covers macOS/Linux and targeted Windows regressions; Windows interactive terminals and physical USB/serial behavior still need real-environment validation.

## Quick start

On the on-site computer connected to the device:

```sh
npx @masstensor/diagnose@latest start
```

In v0.8+, press Enter to review tasks and results, choose `a` to approve tasks and results automatically after confirming the connection, or choose `e` to preapprove all three for this one-time invitation. Keep the terminal open and privately share its nine-letter invitation, such as `abc-def-ghi`, with the diagnostician.

### Manual agent mode (recommended for a first session)

Install once from this GitHub repository. The native Skill uses Diagnose 0.8.5 and starts the local runtime on demand through Node.js and npm.

| Agent | Install | Use |
| --- | --- | --- |
| Claude Code | `/plugin install diagnose --marketplace zkwasm/diagnose` | `/diagnose:connect` |
| Codex CLI | `codex plugin marketplace add zkwasm/diagnose`, then `codex plugin add diagnose@diagnose` | `$diagnose:connect` in a new session. |
| Gemini CLI | `gemini skills install https://github.com/zkwasm/diagnose.git --path skills/connect` | Ask Gemini to use the `connect` skill. |

Open your agent, give it the private invitation and the device symptom, then guide the next checks in chat. You can also start an interactive session with Diagnose MCP already configured:

```sh
npx @masstensor/diagnose@latest agent codex
# Or: agent claude / agent gemini
```

The launcher loads Diagnose MCP for this session. Tell the agent what to check:

> Use Diagnose with invitation abc-def-ghi. The OWON gateway is connected to the on-site computer by USB serial. Plug readings have stopped. Confirm the interface and look for relevant logs. Explain the evidence before proposing a change. We can verify recovery when fresh readings reach the dashboard.

Diagnose 0.8.1 reports pairing progress. Check the [first device check](docs/guide/diagnose.md#run-a-diagnostic-session) for how to distinguish a connected probe, an identified interface, and an actual response from the device.

The user grants permission locally, either when the connection arrives or in advance with **Approve everything**. Automatic task approval includes both execution and result transmission. Possessing a pairing code does not establish the diagnostician's real identity.

Both endpoints can resume a temporary session after a network drop on 0.8.5+. Keep the on-site probe open and use the same skill session handle or case. See the [reconnect guide](docs/guide/reconnect.md#resume-the-current-session) and [Windows desktop preview](docs/guide/on-site.md#windows-desktop-preview).

### Start automatically with a device procedure

Pass a Markdown skill for the device or recurring fault when launching the agent. It starts the procedure automatically, asks for missing connection details, and uses evidence to guide follow-up checks and verify authorized repairs.

```sh
npx @masstensor/diagnose@latest agent codex --skill ./device.md
```

Short invitations require **0.7.0+ on both endpoints** and a compatible relay. With a 0.8.4+ on-site probe and relay, they last two hours and are consumed by successful pairing. The site user authorizes pairing at the prompt or in advance by choosing **Approve everything**. Existing remembered pairings remain valid. See the [protocol design](PAIRING_PROTOCOL.md).

For a custom automation client, run `diagnose mcp` as a stdio subprocess. See the [native setup](docs/guide/diagnose.md#use-diagnose-as-a-native-agent-skill) and [automation setup](docs/guide/automation.md#direct-cli-and-other-mcp-clients) for the two entry points.

## Pair once, return later

Requires **0.5.0+ on both computers**. The user keeps `diagnose start` running. On the diagnostician's computer:

```sh
diagnose pair --name alice-pc
# Enter the temporary code and your label/provider; user confirms remembering.
diagnose agent codex --device alice-pc --skill ./devices/owon.md
# Same options for claude or gemini; --skill is optional.
```

Restart the agent whenever needed without a new code. Pairing persists across probe restarts, but access requires the foreground probe. Task approval remains the default. The user may grant automatic execution and transmission for one hour, or explicitly until revoked. Local `pause`, `permissions ask`, and `unpair` control access. Interrupted modifications are never automatically replayed. See the [pairing guide](docs/guide/reconnect.md#keep-a-device-paired-for-future-diagnosis).

## Start with a device skill or Markdown task

Requires **0.4.0+**. Use the same option with every supported agent:

```sh
diagnose agent codex --skill ./devices/owon.md
diagnose agent claude --skill ./devices/owon.md
diagnose agent gemini --skill ./devices/owon.md
```

A directory is also accepted: `--skill ./skills/my-device` reads its `SKILL.md`. Relative references remain based on that file's original directory. Diagnose snapshots the entry and supplies a startup task that tells the agent to read it and begin, instead of waiting for you to repeat the task. It asks for a pairing code or other missing target details when needed.

This is a session task, not a global native-skill installation or an additional permission grant. User approvals and the agent's own tool permissions still apply. Instructions can be sent to your AI provider. See the [guide](docs/guide/procedures.md#start-with-a-device-skill-or-markdown-task) and [examples](https://github.com/zkwasm/diagnose/tree/main/examples/skills).

## Keep and improve device knowledge

Version 0.6 adds device diagnosis cases, evidence-linked conclusions, reviewed skill drafts, a local versioned library and optional encrypted cross-computer synchronization. Tell your agent to create a case and propose a reusable procedure when useful. Review drafts locally; the agent cannot accept them through MCP. Complete skill bundles can be shared through the relay using a separate private recovery credential. Raw case logs are not synced automatically.

See the [case and knowledge guide](docs/guide/procedures.md#record-a-device-diagnosis-and-improve-your-procedures) and [security/operations design](KNOWLEDGE_SECURITY.md).

## From problem to verified result

1. **Define the problem:** agree on the symptom and what a successful outcome looks like.
2. **Investigate:** inspect the environment, gather evidence, and identify the likely cause.
3. **Plan the fix:** explain the proposed changes, their impact, and recovery options where available.
4. **Act with permission:** use approved commands, scripts, or file changes to carry out the fix.
5. **Verify and hand off:** repeat the original check, summarize changes, and identify any remaining issues.

This is an agent-guided workflow using the existing tools and permission model. Diagnose does not automatically prove a repair succeeded or roll back arbitrary changes. See the [troubleshooting workflow](docs/guide/diagnose.md#from-a-reported-problem-to-a-verified-result).

## Remote tools

The [native skill](docs/guide/diagnose.md#what-the-native-skill-can-do) supports temporary pairing, progress updates, system inspection, serial diagnostics, bounded file operations, single shell commands, and batches. The full launcher and stdio MCP provide the wider tool set below, including whole scripts, live terminals, file transfers, and remembered connections.

| Capability | Interface |
| --- | --- |
| Inspect OS, runtime, commands, privileges, and serial ports | `system.inspect` |
| Inspect CPU use, parent processes, free disk space, and log growth | `system.performance` |
| Execute commands or complete scripts; submit up to 32 sequential steps | `process.run`, `process.script`, `batch.run` |
| Stream output, send stdin, resize a real PTY, and send signals | `process.open`, resource controls |
| Keep an explicitly retained job running across network loss | `resource.resume` with its ID and recovery credential |
| Transfer exact binary files with SHA-256 verification and resume | `file.transfer`, `diagnose_transfer` |
| Read, write, list, inspect, create, remove, rename, and change file permissions | `file.*` |
| Forward TCP locally or in reverse; use SOCKS5 TCP | `net.forward`, `diagnose_forward` |
| Capture a serial port or send explicitly authorized bytes | `serial.capture`, `serial.exchange` |
| Use a native remote terminal without an AI agent | `diagnose terminal` |

No device-specific integration is required in the probe. An approved script can use tools already available on the user's computer. Diagnose does not implement the SSH wire protocol or accept `ssh`, `scp`, or `sftp` clients. It does not provide a desktop viewer, SSH agent/X11 forwarding, UDP, TUN, or public forwarding listeners.

An agent can supply a stable `requestId` for a task and poll that ID for its original result. Repeating the same keyed submission within the same MCP process returns the original ID. [Task tracking and retries](docs/guide/automation.md#track-a-task-without-running-it-again)

## Trust and data boundaries

- Both endpoints initiate outbound connections to the relay, normally over HTTPS/WSS on port 443. No inbound port or SSH server is required on the user's computer.
- The Noise protocol encrypts commands and results between the endpoints. The relay cannot read their contents, but can observe connection metadata and interrupt service.
- Approved processes have the current OS user's permissions. **Diagnose is not a sandbox.** It does not automatically elevate privileges or install a background service.
- Finite text results receive best-effort credential redaction. Live terminals, exact file transfers, and TCP traffic are raw and **not redacted**.
- Results are visible to the diagnostician and the AI provider they use. End-to-end encryption does not hide data from those recipients.
- Local audit logs record decisions, targets, hashes, byte counts, and outcomes. Encrypted history keeps exact task requests, finite collected results, approvals, and send events: use `diagnose history`, `diagnose show ID`, and `diagnose cleanup --days 0`. History and resource journals each have a 256 MiB / 2,000-record budget and seven-day inactive retention. They do not reconstruct every side effect of an arbitrary program. Changes are not automatically rolled back.
- `permissions ask`, `cancel`, and `Ctrl+C` are local controls. Data already transmitted cannot be recalled.

Read the [user guide](docs/guide/troubleshooting.md#security-and-local-data) before operating a session. The protocol has not received an independent security audit.

## Development

Development scripts use Node.js 22.18+ to run TypeScript directly. Installed CLI runtime support starts at Node.js 20.10; users do not need to upgrade an existing compatible runtime.

```sh
npm ci
npm run check
npm test
npm pack
```

Tests exercise the actual encrypted protocol, approval boundaries, native terminals, transfers, forwarding, recovery, and the stdio MCP interface. The Noise tests include a public Cacophony interoperability vector. Hardware acceptance scripts and device logs are not distributed.

The `site/` directory contains the static landing page, a small TypeScript interaction module, and a build script that renders the guide. Run `npm run build:site` and `npm run check:site`; serve `.site-dist/` to preview. No analytics, third-party scripts, or cookies are required. The 60-second English animation illustrates a USB gateway diagnosis using the native agent skill, local approval, and a fresh dashboard reading to verify recovery. Reproduce it with `npm run video:render`. [Video documentation](https://github.com/zkwasm/diagnose/blob/main/video/README.md)

## Relay deployment

`deploy/ecosystem.config.cjs`, `deploy/start-relay.sh`, and `deploy/Caddyfile` provide deployment templates. The relay binds to `127.0.0.1:8792`; Caddy terminates TLS. Its launcher disables core dumps. The service has no database or runtime decryption keys, does not persist diagnostic content, and does not enable Caddy access logging.

The production domain serves the landing page and guide while `/v1/connect`, `/v1/library`, `/v1/library/*`, `/healthz`, and `/downloads/*` reach the relay. Set `VAULT_PATH` to a persistent directory outside code releases to enable the optional encrypted skill store. It persists ciphertext and revocation markers, never plaintext skill contents or raw case logs. See [library operations](KNOWLEDGE_SECURITY.md). Deploy only the package's allowlisted files and public website assets. Never synchronize a diagnostic workspace, credentials, or hardware logs to the server.
