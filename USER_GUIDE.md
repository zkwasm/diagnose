# Diagnose user guide

Diagnose helps an AI agent remotely diagnose and resolve problems on a consenting user's computer or connected devices. The goal is to move from a reported symptom to an authorized fix and a checked result. The same probe can access the computer itself, a USB device, or a device reachable on its local network.

There are two people in a session:

- **User:** the person whose computer or connected device needs diagnosis. They run `diagnose start` and control permissions locally.
- **Diagnostician:** the person directing the AI agent. They run `diagnose agent codex`, `diagnose agent claude`, or `diagnose agent gemini` and give the agent the user's pairing code.

The AI runs on the diagnostician's side. The user does not need to install an AI agent or configure MCP.

## From a reported problem to a verified result

Use the session to work toward a concrete outcome:

1. **Describe the problem.** Explain what fails, what you expected, and how to reproduce it. Agree on the check that will show whether the problem is resolved.
2. **Investigate first.** Ask the agent to inspect the environment and collect relevant logs or other evidence. Distinguish confirmed facts from possible causes.
3. **Review a repair plan.** Have the agent explain what it intends to change, why, the expected impact, and any recovery option. Where practical, preserve the original configuration before editing it.
4. **Apply authorized changes.** The agent can use commands, scripts, file edits, and device tools under the user's existing permission mode. Only proceed within the agreed scope.
5. **Verify the result.** Repeat the original failing action or an appropriate health check. Ask for a summary of what changed, the verification evidence, and anything still unresolved. An executed command alone does not establish that the user's problem is fixed.

These are instructions for directing the agent, not a separate enforced plan-approval system. The local task/channel permissions described below still apply. Automatic mode continues to allow execution and transmission under the user's grant; general automatic rollback is not provided.

You can also request a read-only investigation and stop after the explanation. Computer software, configuration, local services, networks, and connected hardware can all be investigated with the same general-purpose tools; successful fixes depend on the issue, available access, and the user's authorization.

## 1. Requirements

Both computers need **Node.js 22.18 or later**, npm, an interactive terminal, and outbound access to the relay. The default relay is `https://diagnose.fenginwind.com`. No inbound port, router change, or SSH server is required.

For an AI session, the diagnostician must separately install and sign in to Codex CLI, Claude Code, or Gemini CLI. Diagnose does not install an agent, provide a model subscription, or change the agent's approval mode.

Use the latest package on both endpoints. Session agent launchers require 0.3.1 or later; live resource features require 0.3 or later. macOS probes and the Linux relay have been tested. Linux and Windows probes, including Windows ConPTY and Gemini symlink permissions, remain experimental.

## First-time setup: install Node.js and npm

If you are the person receiving help, this is the only software setup you need. You do **not** need a Codex, Claude, Gemini, or npm account. Your diagnostician runs the AI on their own computer.

**Node.js** runs Diagnose. **npm** downloads it. **npx** starts it without requiring a separate global installation. The official Node.js installer includes npm and npx; do not download them from separate websites.

If Node.js is already installed, go straight to [Check the installation](#check-the-installation). Otherwise, follow the instructions for your computer below. The installer may ask for your computer's normal administrator approval. Enter any OS password only in your computer's own prompt, not in a chat or the diagnostic session.

### Windows

1. Open [the official Node.js download page](https://nodejs.org/en/download) in your web browser.
2. Select **Node.js 22 LTS**, version **22.18 or later**, in the version selector. This is the major version used for Diagnose's existing validation. Select **Windows** and download the **Windows Installer (.msi)**, rather than a ZIP archive or source code. The page's first selected version may be a different major release.
3. Use **x64** for most Intel/AMD PCs. For an ARM-based PC, use **ARM64**. If unsure, check **Settings → System → About → System type** or ask the person helping you.
4. Open the downloaded `.msi` file and follow the installer. Keep the default features, including **npm package manager** and **Add to PATH**. You do not need to select optional extra development tools just to follow this guide.
5. Close any command or terminal windows that were open before installation.
6. Open the **Start** menu, type **Command Prompt** or **cmd**, and open it. This is the window where you will paste the commands below; you do not need to run it as administrator.

The Windows probe is still experimental. If a feature or device driver does not work, keep the error message and ask your diagnostician for help.

### Mac

1. Open [the official Node.js download page](https://nodejs.org/en/download) in Safari or another web browser.
2. Select **Node.js 22 LTS**, version **22.18 or later**, in the version selector. Select **macOS** and download the **macOS Installer (.pkg)**, rather than a compressed archive or source code.
3. If asked for a processor type, choose **ARM64** for Apple silicon (M1, M2, M3, or later) or **x64** for an Intel Mac. Check **Apple menu → About This Mac** if you are unsure.
4. Open the downloaded `.pkg` file and follow the installer, keeping its default features.
5. Close terminal windows that were open before installation.
6. Press **Command + Space**, type **Terminal**, and press **Return**. Paste the commands below into this Terminal window.

You do not need Homebrew, a version manager, or a developer account for this installer-based route.

### Linux or a managed work computer

For Linux, follow the [official Node.js installation instructions](https://nodejs.org/en/download) for your distribution and ensure the installed version is **22.18 or later**. Distribution package repositories can contain older versions. Linux probes remain experimental.

If a work or school computer does not allow software installation, ask your IT administrator or diagnostician for help. Do not change security policies to get around the restriction.

### Check the installation

In Command Prompt on Windows, or Terminal on a Mac, paste **one line at a time** and press Enter/Return after each:

```sh
node --version
npm --version
npx --version
```

Each command should print a version number. The Node.js number begins with `v` and must be **22.18.0 or later**. npm and npx have their own version numbers; they do not need to match Node.js. If your installed Node.js already meets the requirement, you do not need to reinstall it.

You are now ready. Paste this single command into the same window and press Enter/Return:

```sh
npx @masstensor/diagnose@latest start
```

The first run downloads Diagnose and may take a little time. If npm asks whether to install `@masstensor/diagnose`, type `y` and press Enter. You do not need to run `npm login` or create an npm account. When the pairing code appears, installation is complete: keep the window open and send the code privately to your diagnostician. Continue with [Start on the user's computer](#2-start-on-the-users-computer) for the connection and approval details.

Copy only the command, not a leading dollar-sign prompt, the surrounding code-box marks, or example output. On a Mac, stopping the probe is **Control + C**, not Command + C.

### If something goes wrong

| What you see | What to do |
| --- | --- |
| “node is not recognized” or “command not found” | Close and reopen Command Prompt/Terminal, then try again. If it still fails, run the official installer again with the default PATH option, or ask your diagnostician for help. |
| An older Node.js version | Install Node.js 22 LTS at version 22.18 or later, reopen the terminal, and repeat the three version checks. |
| npm or npx is missing | Re-run the official Node.js installer with npm selected. npm and npx should come with it. |
| PowerShell says `npm.ps1` or `npx.ps1` cannot run because scripts are disabled | Open **Command Prompt (cmd)** and run the same commands there. You do not need to change PowerShell's execution policy. |
| “EACCES”, “EPERM”, or “permission denied” during a global install | Use the `npx … start` command above instead of `npm install -g`. If that also fails, share the error with your diagnostician; do not add `sudo` or change folder permissions at random. |
| A download, certificate, or network error | Check your internet connection and ask your diagnostician or IT administrator for help. Do not disable certificate checks or your firewall. |
| A build/driver error, or the device is not listed | Share the error with the diagnostician. Node.js installation does not install every device's USB or serial driver. |

Official references: [Node.js downloads](https://nodejs.org/en/download) and [npm's Node.js/npm installation guide](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/).

## 2. Start on the user's computer

```sh
npx @masstensor/diagnose@latest start
```

Or install once:

```sh
npm install -g @masstensor/diagnose@latest
diagnose start
```

The terminal shows a pairing code beginning with `D1.` and the local audit log path. Keep it open. Share the **complete code privately** with the intended diagnostician. The initial invitation lasts 10 minutes. Treat the code as a secret; do not post it publicly or place it in shell arguments.

The probe will show the connecting party's self-reported label and the session fingerprint. Check these with the intended diagnostician before accepting. A code proves possession of the secret, not a person's identity.

## 3. Start the diagnostician's agent

Choose one:

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

> Use Diagnose to connect to pairing code D1.… . Help resolve the user's application startup failure. First investigate without changing anything. Explain the cause, proposed fix, and risks. Apply only authorized changes, then check whether the application starts successfully. Summarize what changed and anything still unresolved.

The code and diagnostic results enter your chosen AI provider's context. The user must still accept the connection on their own computer. Ask the agent to use the `diagnose_*` tools for remote actions: its normal shell and file tools still act on the diagnostician's computer.

### Session configuration and extra arguments

```sh
diagnose agent codex --relay https://your-relay.example -- --model your-model
```

Options before `--` belong to Diagnose. Everything after it is passed literally to the agent, without a shell. Do not put pairing codes, passwords, or recovery credentials in these arguments.

- **Codex:** receives temporary `-c` MCP overrides.
- **Claude Code:** receives a temporary `--mcp-config` value.
- **Gemini CLI:** uses a private temporary user configuration directory. Diagnose copies the user settings, adds its MCP entry, and links existing login/history files. Administrator policies and workspace trust checks remain in effect. The directory is removed on normal exit; changes to user settings in this Gemini session are not written back to the original `settings.json`.

The launcher does not add a permanent MCP entry. Other MCP servers already configured in your agent may still load. If you previously registered Diagnose globally, remove that entry separately if you no longer want it in ordinary sessions. An uncatchable kill or power loss may leave a temporary directory behind.

## 4. Choose permissions on the user's computer

At the connection prompt:

| Choice | Effect |
| --- | --- |
| `y` | Approve the session, then review each operation or batch and its result transmission. |
| `a` | Authorize automatic execution **and automatic transmission** for this temporary session. Subsequent tasks do not prompt again. |
| `N` or Enter | Refuse the connection. |

In manual mode, a batch has one execution approval and one combined result approval, rather than one prompt per step. Complete scripts are approved as a whole, not line by line.

Opening a live process, file transfer, or network tunnel asks for permission to its **continuing raw input/output before the resource is created**. Once granted, input, reads, resizing, signals, and connections within that handle's scope do not prompt again.

Automatic mode is powerful: commands run with the user's OS permissions and results go directly to the diagnostician and their AI. The probe is not a sandbox. Arbitrary programs can have side effects that Diagnose cannot fully observe or undo.

### Local session controls

Type these into the user's probe terminal:

| Command | Effect |
| --- | --- |
| `permissions` | Show the current mode. |
| `permissions ask` | Revoke automatic approval, cancel active work and resources, and require approval again. |
| `permissions auto` | Show the automatic execution/transmission explanation. |
| `permissions allow-auto` | Confirm the preceding request within 60 seconds. |
| `jobs` | List locally known resources. |
| `recover <resource-id>` | Rotate a resource's recovery credential; share the new value privately. |
| `secret <resource-id>` | Send hidden local input directly to an approved live process on macOS/Linux. A program may still echo it into output. |
| `cancel` | Cancel current work and retained resources without changing the permission mode. |
| `exit` or `Ctrl+C` | End the probe and close its resources. |

Only the user can enable automatic mode. Remote requests cannot switch it on. New pairings start with manual approval unless the user explicitly chooses `a` again. Already transmitted data cannot be recalled. Completed changes are not automatically rolled back.

Do not ask the AI to collect OS passwords. For interactive authentication, the user can use local hidden input with a trusted foreground program; Diagnose does not automatically elevate privileges. Hidden input has not been validated on Windows.

## 5. What the agent can do

The MCP interface provides 11 tools:

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

`file.read` returns a bounded range of up to 1 MiB. `file.write` previews text and checks the previous hash before replacing a target. File listing, stat, mkdir, removal, rename, and chmod are available; rename refuses an existing destination unless overwrite is explicit.

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

## 6. Disconnect and recover

When a connection drops, finite jobs are cancelled and serial handles close. The user's probe stays running and displays a **new pairing code**. Pair again, obtain new local consent, then resume a retained resource using its original ID and recovery credential. Diagnose never silently replays a creation command.

Ordinary live processes default to `retainOnDisconnect:false`; file transfers default to retained. A retained live process survives network loss only while the original probe process remains running. If the probe itself disappears, a new probe can recover encrypted saved output and supported file staging, but cannot take over the old process's PTY. Network connections must be recreated.

For download resume, keep the partial file and sidecar together. Upload resume uses the resource ID and recovery credential reported in progress. If a response is lost during a modifying action, inspect resource status before retrying; do not blindly restart the command.

## 7. Limits and timeouts

| Limit | Default / maximum |
| --- | --- |
| Invitation | 10 minutes |
| Idle session / total session | 10 minutes / 60 minutes by default |
| Finite command or script | 60 seconds by default; 300 seconds maximum |
| Batch | Up to 32 steps; 300 seconds; 10 MiB combined output |
| Concurrent finite jobs | 4 |
| Active live resource handles | 128 |
| Live process | 1 hour by default; `timeoutMs:0` removes its timer |
| Retained output per live process | 64 MiB by default; 1 GiB maximum; reaching the cap terminates the process |
| Relay session | At most 7 days, also subject to cipher frame limits |

```sh
diagnose start --session-minutes 240 --idle-minutes 30
```

Set a session or idle timeout to `0` to disable that endpoint timer; relay and cipher limits still apply. Both endpoints should use a compatible current version. POSIX processes that deliberately detach from their process group cannot always be terminated by group cancellation.

## 8. Manual operation and other MCP clients

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

## Security and local data

Diagnose uses Noise `NNpsk0_25519_ChaChaPoly_BLAKE2b`, a random 256-bit pairing secret, ephemeral X25519 keys, independent direction counters, and routing/role/version binding. Tests include a public Cacophony test vector. Each direction is limited to one million frames, below the dependency's 32-bit counter boundary. WSS also validates the relay certificate. No independent security audit has been completed.

The relay keeps rooms and ciphertext buffers in memory. It does not persist diagnostic contents, endpoint decryption keys, or offline messages. It can see IP addresses, routing identifiers, connection timing, and traffic volume, and can deny service. A self-reported label is not verified identity.

The diagnostician, their endpoint software, and their AI provider can see results. Do not share a code or approve a session with someone you do not intend to trust.

### Audit logs

`~/.diagnose/audit-*.jsonl` uses mode `0600`. Events record task IDs, operation types, target paths/executables/interpreters, ranges and serial settings, argument digests, decisions, collection/transmission byte counts, cancellations, and outcomes. Batch steps include their parent task and individual status. Automatic mode records its permission changes and automatic approvals.

Built-in file mutations record paths and, where available, before/after hashes and byte counts. Default audit logs do not store full command arguments, script source, or raw collected contents. They are not a complete command replay or filesystem monitor. Audit writes are flushed; an unwritable audit log stops the affected operation.

### Saved output and recovery data

Raw live output and recovery metadata are stored under `~/.diagnose/resources` using AES-256-GCM records. The local key has mode `0600` in the same account's directory. This protects stored ciphertext from casual inspection, not an attacker who controls that OS account and can read the key. Saved output is not automatically pruned; clean it up when it is no longer needed.

Finite text results receive best-effort common-credential redaction and terminal-control filtering. Regexes cannot identify every secret. Live terminals, exact file transfers, and TCP channels retain raw data and are not redacted. Collection and transmission are audited separately.

Commands run with the current user's OS permissions. Diagnose neither provides a sandbox nor automatically elevates privileges. It cannot completely observe arbitrary process side effects, undo completed modifications, or isolate against hostile local concurrent changes.

## Troubleshooting

- **Agent CLI not found:** install and sign in to that CLI separately, and ensure it is on `PATH`.
- **No Diagnose tools:** use `diagnose agent <name>` to start a new agent session. An already running unrelated agent will not acquire the new MCP automatically.
- **Invitation expired or connection refused:** keep the probe open and use its latest complete code; the user must accept locally.
- **Gemini trust or account error:** complete its normal workspace trust and authentication flow. Diagnose does not bypass these checks.
- **Resource not attached:** request `diagnose_resume` after the new pairing, with the original ID and recovery credential.
- **Upload/download hash mismatch:** do not replace the destination. Confirm the source has not changed and inspect transfer status before retrying.
- **Missing serial device:** verify the cable carries data, check OS drivers and permissions, and list ports again. Opening a port may reset the device.

## Source, hosting, and video

[Source and issues](https://github.com/zkwasm/diagnose) · [npm package](https://www.npmjs.com/package/@masstensor/diagnose)

The public relay is hosted at `diagnose.fenginwind.com`. You can self-host using the deployment templates in the repository. Keep local credentials, hardware logs, firmware, and resource journals out of server deployments and public packages.

The [one-minute English walkthrough](https://diagnose.fenginwind.com/#walkthrough) covers the current agent launcher, local permissions, encrypted transport, investigation, authorized repair, and verification. It includes English narration and captions. The port-mismatch repair is an illustrative example, not a live diagnosis. The earlier Chinese video is retained separately.
