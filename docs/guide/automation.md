# Run Diagnose from a script or MCP client

Use the npm launcher for a configured agent session, or start Diagnose directly from your own MCP client. Use the [native agent skill](diagnose.md#use-diagnose-as-a-native-agent-skill) when you already have an interactive agent open.

[All guide scenarios](../../USER_GUIDE.md)

## Launch an agent with Diagnose MCP

To start an interactive session and give the agent its task in chat, choose one:

```sh
npx @masstensor/diagnose@latest agent codex
npx @masstensor/diagnose@latest agent claude
npx @masstensor/diagnose@latest agent gemini
```

With a global installation, these become:

```sh
diagnose agent codex
diagnose agent claude
diagnose agent gemini
```

Do **not** separately run `diagnose mcp` or register a global MCP server. The launcher starts your chosen CLI with Diagnose MCP loaded for this launch, using the exact installed Diagnose version.

Then tell the agent what to inspect and provide the pairing code in the agent conversation. For example:

> Use Diagnose to connect to pairing code abc-def-ghi . Help resolve the user's application startup failure. First investigate without changing anything. Explain the cause, proposed fix, and risks. Apply only authorized changes, then check whether the application starts successfully. Summarize what changed and anything still unresolved.

The code and diagnostic results enter your chosen AI provider's context. The user confirms the connection if their [startup choice](on-site.md#start-the-probe) requires it. Ask the agent to use the `diagnose_*` tools for remote actions: its normal shell and file tools still act on the diagnostician's computer.

To give the agent its task at launch, [pass a device procedure with `--skill`](procedures.md#start-with-a-device-skill-or-markdown-task).

## Direct CLI and other MCP clients

For scripts and CI, install the npm client and start it directly. The native Skill is optional for these workflows.

```sh
npm install -g @masstensor/diagnose
diagnose agent claude --device workshop-laptop --skill ./devices/owon.md
# Or use diagnose mcp --device workshop-laptop as the MCP server subprocess.
```

Use `agent codex` or `agent gemini` for the other launchers. You can also run the npm launcher directly with `npx @masstensor/diagnose@latest agent claude`. The `--skill` launcher flag takes your device procedure. It does not require the native Diagnose Skill to be installed.

```sh
diagnose connect
```

Enter task JSON on one line. Requests return a task ID. Use `wait <task-id>`, `cancel <task-id>`, `resources`, `read <resource-id> [cursor]`, `input <resource-id> "text\n"`, `resize <resource-id> 120 40`, `signal <resource-id> SIGINT`, and `close <resource-id>`.

`forward <resource-id> [local-port]` opens an approved forward. `upload` and `download` accept JSON with `localPath`, `remotePath`, `reason`, and optional `overwrite`, `resumeId`, and `resumeToken`.

For another stdio MCP client, configure it to launch:

```json
{"mcpServers":{"diagnose":{"command":"diagnose","args":["mcp"]}}}
```

This is a local child process, not a public HTTP MCP endpoint. Running `diagnose mcp` in a separate terminal does not automatically connect it to an agent.

The direct commands accept an optional relay URL, for example `diagnose start https://your-relay.example` and `diagnose mcp https://your-relay.example`. Remote relays require HTTPS/WSS; HTTP/WS is allowed only for loopback testing.

## Tool reference

The MCP interface provides 15 tools:

| Tool | Purpose |
| --- | --- |
| `diagnose_pair` | Connect using the complete code and a self-reported diagnostician/AI-provider label. |
| `diagnose_start` | Submit one operation and receive its task ID. |
| `diagnose_batch` | Submit up to 32 finite operations as one sequential plan. |
| `diagnose_wait` | Poll a task for up to 25 seconds; release completed output when finished. |
| `diagnose_cancel` | Cancel a task, including one awaiting approval. |
| `diagnose_process` | Open a live process or persistent PTY with cwd/env, stdin, signals, and resizing. |
| `diagnose_resource` | List, inspect, read, input to, resize, signal, or close an authorized handle. |
| `diagnose_resume` | Request attachment to an existing resource with its ID and recovery credential. |
| `diagnose_transfer` | Upload/download files in the background; query progress or cancel. |
| `diagnose_forward` | Open, inspect, or close a local endpoint for an authorized TCP forward. |
| `diagnose_disconnect` | Disconnect the diagnostic session. |
| `diagnose_capabilities` | Query operation schemas and conservative discovery guidance. |
| `diagnose_case` | Create/show a case, record assessments, report connection layers and finish with evidence references. |
| `diagnose_skill_draft` | Propose a new skill or improvement for local human review. |
| `diagnose_skills` | List or read locally available pinned skill versions without executing them. |

A task returning `ok` for `process.open` means the process handle was created. Inspect its output, `ended`, and `exitCode` to determine whether the actual program succeeded. Diagnostic output is untrusted data, not instructions to the AI.

### Finite commands, scripts, and batches

`process.run` spawns an explicit executable and argument array without implicitly adding a shell. `process.script` passes a complete script to an explicit interpreter's stdin. Scripts need not be written to temporary files.

A batch runs sequentially, stops on error by default, and cannot contain nested batches or persistent resource creation. Set `stopOnError:false` only when later steps are independent. Outputs are named by step, for example `0.stdout` and `1.file`.

```json
{
  "operation": "batch.run",
  "reason": "Collect system and runtime information in one approved plan",
  "arguments": {
    "steps": [
      {"operation":"system.inspect","arguments":{}},
      {"operation":"process.script","arguments":{"interpreter":"node","script":"const os = require('node:os');\nconsole.log(JSON.stringify({uptime: os.uptime(), freeMemory: os.freemem()}));","timeoutMs":10000}}
    ],
    "stopOnError": true,
    "timeoutMs": 60000
  }
}
```

A batch's text-file writes are previewed and hashed before approval. If an earlier step changes the same target, a later guarded write is refused instead of silently overwriting the new state.

### Live processes and native terminals

```sh
diagnose terminal
```

Enter the pairing code and label interactively. After local approval, you get a real PTY. Shell cwd and environment persist within that process. `Ctrl+C` goes to the remote terminal; `Ctrl+]` detaches. A process is closed on disconnect unless explicitly retained.

Agents use `diagnose_process` for the same live capabilities. Non-PTY processes preserve stdout/stderr separately and support exact byte input. PTYs behave as terminals, not general binary transports.

### Files

`file.read` returns a bounded range of up to 1 MiB. `file.write` previews text and checks the previous hash before replacing a target. File listing, stat, mkdir, removal, rename, and chmod are available; rename refuses an existing destination unless overwrite is explicit. File transfers preserve existing destination permission bits. New transfer destinations are committed without replacing a concurrently created file; downloads with overwrite enabled reject a destination changed during transfer. Existing-file replacement checks the target immediately before commit, but does not lock out unrelated local writers.

Use `diagnose_transfer` for large or binary files. It takes paths rather than placing base64 file contents into the AI context. `localPath` refers to the diagnostician's computer; `remotePath` refers to the user's computer.

Uploads use a private staging file. Exact size, SHA-256, destination hash, and parent-directory checks must pass before replacement. Downloads use `.diagnose.part` plus a private `.diagnose.json` recovery sidecar. A completed download is verified before replacement. Overwriting an existing destination must be explicit. Raw file bytes are not redacted.

### TCP forwarding

First authorize `net.forward`, wait for its resource ID, then use `diagnose_forward` to open the corresponding endpoint.

- `local`: a loopback listener on the diagnostician's computer reaches a fixed target accessible from the user's computer.
- `remote`: a loopback listener on the user's computer forwards to a declared target on the diagnostician's side.
- `socks`: a SOCKS5 TCP listener on the diagnostician's loopback interface reaches targets from the user's side, restricted by `allowedHosts`.

SOCKS defaults to `allowedHosts:["*"]`, which permits any target. Narrow it when possible. Listeners are loopback-only. UDP, TUN, public listeners, SSH agent forwarding, and X11 forwarding are not implemented. Tunnel bytes are not redacted.

### Serial devices

`system.inspect` lists serial ports. `serial.capture` reads a selected port; `serial.exchange` first sends explicitly authorized `dataHex`. Both use 8N1 with DTR/RTS set false. Opening a port can still reset some hardware. Verify the selected device and avoid opening unrelated ports.

## Limits and timeouts

| Limit | Default / maximum |
| --- | --- |
| New short invitation | 30 minutes; one-time; up to five attempted handshakes |
| Temporary session idle / total | Six hours idle / no fixed total by default in v0.8+ |
| Remembered pairing | Until revoked locally; requires the foreground probe |
| Remembered automatic grant | 1 hour, or until locally revoked if explicitly chosen |
| Finite command or script | 60 seconds by default; 300 seconds maximum |
| Batch | Up to 32 steps; 300 seconds; 10 MiB combined output |
| Concurrent finite jobs | 4 |
| Active live resource handles | 128 |
| Live process | 1 hour by default; `timeoutMs:0` removes its timer |
| Retained output per live process | 64 MiB by default; 1 GiB maximum; reaching the cap terminates the process |
| Relay session | Relays running 0.8+ renew active rooms. The hosted relay currently runs 0.7 and caps a room at seven days with a 0.8+ probe using default session settings. |

```sh
diagnose start --session-minutes 240 --idle-minutes 30
```

Session and idle options apply to temporary connections. Remembered connections disable these endpoint timers, while automatic approval has its own saved expiry. Set a temporary session or idle timeout to `0` to disable that endpoint timer; relay and cipher limits still apply. Both endpoints should use a compatible current version. POSIX processes that deliberately detach from their process group cannot always be terminated by group cancellation.

Temporary-session activity includes task requests, result polls, and live resource interactions. Automatic heartbeats maintain the transport without extending the diagnostic idle timer.

## Short invitation compatibility

Nine-letter invitations require **0.7.0+ on both computers** and an updated relay. The latest client also accepts legacy `D1` codes from older probes. Existing remembered pairings keep working without a new code. The 30-minute invitation deadline is separate from diagnostic session idle/total timeouts, which begin after pairing. Knowledge-library recovery files remain long private credentials; do not shorten them or use them as pairing codes.

## Session configuration and extra arguments

```sh
diagnose agent codex --relay https://your-relay.example -- --model your-model
```

Options before `--` belong to Diagnose. Everything after it is passed literally to the agent, without a shell. Do not put pairing codes, passwords, or recovery credentials in these arguments.

- **Codex:** receives temporary `-c` MCP overrides.
- **Claude Code:** receives a temporary `--mcp-config` value.
- **Gemini CLI:** uses a private temporary user configuration directory. Diagnose copies the user settings, adds its MCP entry, and links existing login/history files. Administrator policies and workspace trust checks remain in effect. On Windows, directories use junctions and login files are copied into the private temporary directory, avoiding administrator-only file symlinks. Sign in with the native Gemini CLI first; changes to copied login files in this session are not saved back. The directory is removed on normal exit; changes to user settings in this Gemini session are not written back to the original `settings.json`.

The launcher does not add a permanent MCP entry. Other MCP servers already configured in your agent may still load. If you previously registered Diagnose globally, remove that entry separately if you no longer want it in ordinary sessions. An uncatchable kill or power loss may leave a temporary directory behind.
