# Diagnose

**Diagnose and fix problems remotely with your AI agent.**

Diagnose is an open-source tool for agent-led remote troubleshooting and problem resolution. It gives Codex, Claude Code, Gemini CLI, or another MCP client the remote tools to investigate a user's computer or connected device, apply authorized fixes, and verify the result. A user-controlled probe and an end-to-end encrypted relay provide the connection.

[User guide](USER_GUIDE.md) · [Source](https://github.com/zkwasm/diagnose) · [npm](https://www.npmjs.com/package/@masstensor/diagnose) · [Website](https://diagnose.fenginwind.com)

Requires **Node.js 22.18+**. MIT licensed. TypeScript source is included in the npm package. macOS probes and the Linux relay have been tested; Linux and Windows probes remain experimental.

## Quick start

On the computer being diagnosed:

```sh
npx @masstensor/diagnose@latest start
```

Keep the terminal open and privately share its complete `D1.…` pairing code with the diagnostician.

On the diagnostician's computer, start an already installed and authenticated agent:

```sh
npx @masstensor/diagnose@latest agent codex
# Or: agent claude / agent gemini
```

The agent launcher requires **0.3.1+**. It loads Diagnose MCP for this launch without adding a permanent MCP entry. Tell the agent:

> Use Diagnose to connect to this pairing code: D1.… . Help resolve the user's application startup failure. First investigate without changing anything. Explain the cause, proposed fix, and risks. Apply only authorized changes, then check whether the application starts successfully and report anything still unresolved.

The user must approve the connection locally. They choose per-task approval or automatic execution **and transmission** for this temporary session. Possessing a pairing code does not establish the diagnostician's real identity.

For repeated use:

```sh
npm install -g @masstensor/diagnose@latest
diagnose start
# On the diagnostician's machine:
diagnose agent codex
```

## Start with a device skill or Markdown task

Requires **0.4.0+**. Use the same option with every supported agent:

```sh
diagnose agent codex --skill ./devices/owon.md
diagnose agent claude --skill ./devices/owon.md
diagnose agent gemini --skill ./devices/owon.md
```

A directory is also accepted: `--skill ./skills/my-device` reads its `SKILL.md`. Relative references remain based on that file's original directory. Diagnose snapshots the entry and supplies a startup task that tells the agent to read it and begin, instead of waiting for you to repeat the task. It asks for a pairing code or other missing target details when needed.

This is a session task, not a global native-skill installation or an additional permission grant. User approvals and the agent's own tool permissions still apply. Instructions can be sent to your AI provider. See the [guide](USER_GUIDE.md#start-with-a-device-skill-or-markdown-task) and [examples](https://github.com/zkwasm/diagnose/tree/main/examples/skills).

## From problem to verified result

1. **Define the problem:** agree on the symptom and what a successful outcome looks like.
2. **Investigate:** inspect the environment, gather evidence, and identify the likely cause.
3. **Plan the fix:** explain the proposed changes, their impact, and recovery options where available.
4. **Act with permission:** use approved commands, scripts, or file changes to carry out the fix.
5. **Verify and hand off:** repeat the original check, summarize changes, and identify any remaining issues.

This is an agent-guided workflow using the existing tools and permission model. Diagnose does not automatically prove a repair succeeded or roll back arbitrary changes. See the [troubleshooting workflow](USER_GUIDE.md#from-a-reported-problem-to-a-verified-result).

## Remote tools

| Capability | Interface |
| --- | --- |
| Inspect OS, runtime, commands, privileges, and serial ports | `system.inspect` |
| Execute commands or complete scripts; submit up to 32 sequential steps | `process.run`, `process.script`, `batch.run` |
| Stream output, send stdin, resize a real PTY, and send signals | `process.open`, resource controls |
| Keep an explicitly retained job running across network loss | `resource.resume` with its ID and recovery credential |
| Transfer exact binary files with SHA-256 verification and resume | `file.transfer`, `diagnose_transfer` |
| Read, write, list, inspect, create, remove, rename, and change file permissions | `file.*` |
| Forward TCP locally or in reverse; use SOCKS5 TCP | `net.forward`, `diagnose_forward` |
| Capture a serial port or send explicitly authorized bytes | `serial.capture`, `serial.exchange` |
| Use a native remote terminal without an AI agent | `diagnose terminal` |

No device-specific integration is required in the probe. An approved script can use tools already available on the user's computer. Diagnose does not implement the SSH wire protocol or accept `ssh`, `scp`, or `sftp` clients. It does not provide a desktop viewer, SSH agent/X11 forwarding, UDP, TUN, or public forwarding listeners.

## Trust and data boundaries

- Both endpoints initiate outbound connections to the relay, normally over HTTPS/WSS on port 443. No inbound port or SSH server is required on the user's computer.
- The Noise protocol encrypts commands and results between the endpoints. The relay cannot read their contents, but can observe connection metadata and interrupt service.
- Approved processes have the current OS user's permissions. **Diagnose is not a sandbox.** It does not automatically elevate privileges or install a background service.
- Finite text results receive best-effort credential redaction. Live terminals, exact file transfers, and TCP traffic are raw and **not redacted**.
- Results are visible to the diagnostician and the AI provider they use. End-to-end encryption does not hide data from those recipients.
- Local audit logs record decisions, targets, hashes, byte counts, and outcomes. They do not reconstruct every side effect of an arbitrary program. Changes are not automatically rolled back.
- `permissions ask`, `cancel`, and `Ctrl+C` are local controls. Data already transmitted cannot be recalled.

Read the [user guide](USER_GUIDE.md#security-and-local-data) before operating a session. The protocol has not received an independent security audit.

## Development

```sh
npm ci
npm run check
npm test
npm pack
```

Tests exercise the actual encrypted protocol, approval boundaries, native terminals, transfers, forwarding, recovery, and the stdio MCP interface. The Noise tests include a public Cacophony interoperability vector. Hardware acceptance scripts and device logs are not distributed.

The `site/` directory contains the static landing page, a small TypeScript interaction module, and a build script that renders the guide. Run `npm run build:site` and `npm run check:site`; serve `.site-dist/` to preview. No analytics, third-party scripts, or cookies are required. The website features a 60-second English animation covering the current agent launcher, permissions, encrypted relay, investigation, authorized repair, and result verification. Its repair story is illustrative, not a live diagnosis. Reproduce it with `npm run video:render`; see [video documentation](https://github.com/zkwasm/diagnose/blob/main/video/README.md). The earlier Chinese video is retained unchanged.

## Relay deployment

`deploy/ecosystem.config.cjs`, `deploy/start-relay.sh`, and `deploy/Caddyfile` provide deployment templates. The relay binds to `127.0.0.1:8792`; Caddy terminates TLS. Its launcher disables core dumps. The service has no database or runtime decryption keys, does not persist diagnostic content, and does not enable Caddy access logging.

The production domain serves the landing page and guide while `/v1/connect`, `/healthz`, and `/downloads/*` continue to reach the relay. Deploy only the package's allowlisted files and public website assets. Never synchronize a diagnostic workspace, credentials, or hardware logs to the server.
