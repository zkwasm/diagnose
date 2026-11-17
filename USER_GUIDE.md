# Diagnose user guide

Diagnose helps an AI agent remotely diagnose and resolve problems on a consenting user's computer or connected devices. The goal is to move from a reported symptom to an authorized fix and a checked result. The same probe can access the computer itself, a USB device, or a device reachable on its local network.

There are two people in a session:

- **User:** the person whose computer or connected device needs diagnosis. They run `diagnose start` and control permissions locally.
- **Diagnostician:** the person directing the AI agent. They run `diagnose agent codex`, `diagnose agent claude`, or `diagnose agent gemini` and give the agent the user's pairing code.

The AI runs on the diagnostician's side. The user does not need to install an AI agent or configure MCP.

## Quick start

### 1. Prepare both computers

Run the one-line setup command for your computer. It downloads our open-source installer, reuses existing Node.js without updating it, and installs Node.js/npm/npx only if Node.js is absent. No administrator access is normally needed.

**Windows:** open the Start menu, type **Windows PowerShell**, and open it. Paste:

```powershell
curl.exe -fsSL https://diagnose.fenginwind.com/setup/setup-node.ps1 | Out-String | Invoke-Expression
```

**Mac:** press **Command + Space**, type **Terminal**, and press Return. **Linux:** open Terminal. Paste:

```sh
curl -fsSL https://diagnose.fenginwind.com/setup/setup-node.sh | bash
```

Wait for **Setup complete** and three version numbers. Then close the terminal and open a fresh one before continuing, so a newly installed Node.js is available. On Windows, close all terminal windows and reopen Windows PowerShell from the Start menu. On Windows, use `npx.cmd` and `npm.cmd` wherever this guide says `npx` and `npm`; this avoids PowerShell script-policy errors without changing your security settings. See [setup details and troubleshooting](#first-time-setup-install-nodejs-and-npm) if setup fails.

Only the **diagnostician** needs an installed, signed-in Codex CLI, Claude Code, or Gemini CLI. The person receiving help needs no AI account.

### 2. On the computer receiving help

```sh
npx @masstensor/diagnose@latest start
```

If npm asks to install the package, type `y`. Keep this terminal open. Send the complete `D1.…` code privately to your diagnostician.

### 3. On the diagnostician's computer

```sh
npx @masstensor/diagnose@latest agent codex
# Or replace codex with claude or gemini.
```

In the agent conversation, provide the code and a concrete problem:

> Use Diagnose to connect to this code: D1.… . Investigate why the user's application fails to start. Explain the proposed fix before changing anything, apply only authorized changes, and verify that the application starts afterward.

### 4. Approve, diagnose, and finish

The person receiving help checks the diagnostician's label and connection fingerprint, then chooses `y` to review tasks and result transfers. Choosing `a` instead grants automatic execution **and transmission** under the displayed terms. Commands run with that user's OS permissions; results can reach the diagnostician and their AI provider.

The diagnostician directs the agent to investigate, repair within permission, and check the result. The user can type `permissions ask` to revoke automatic approval or `exit` to stop access. Afterward, `diagnose history` lists local task records and `diagnose show TASK_ID` shows what was requested, collected, and sent.

### Return later or load a device procedure

**Requires v0.5.0+ on both computers.** Use a release supporting these options before following the additional commands below.

```sh
npm install -g @masstensor/diagnose@latest
# Diagnostician: pair once while the user's probe is running.
diagnose pair --name alice-pc
# User: explicitly approve remembering this diagnostician.
# Diagnostician: use this whenever diagnosis is needed again.
diagnose agent codex --device alice-pc --skill ./devices/owon.md
```

The skill file is your local Markdown procedure; create it first or omit `--skill`. The same flags work with `claude` and `gemini`. The user must keep `diagnose start` running, or start it again after a restart. Pairing survives; execution approval remains separately controlled. See [remembered pairing](#keep-a-device-paired-for-future-diagnosis) and [skills](#start-with-a-device-skill-or-markdown-task) for full details.

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

Both computers need **Node.js 20.10 or later**, npm, an interactive terminal, and outbound access to the relay. The default relay is `https://diagnose.fenginwind.com`. No inbound port, router change, or SSH server is required.

For an AI session, the diagnostician must separately install and sign in to Codex CLI, Claude Code, or Gemini CLI. Diagnose does not install an agent, provide a model subscription, or change the agent's approval mode.

Node.js 20.10+ runtime compatibility is available in Diagnose 0.5.0+. Earlier Diagnose packages declare Node.js 22.18+; use a compatible Diagnose version rather than automatically upgrading the user's Node.js. The relay deployment wrapper requires Node.js 22+ separately.

Use the latest package on both endpoints. Session agent launchers require 0.3.1 or later; live resource features require 0.3 or later. macOS probes and the Linux relay have been tested. Automated CI runs the full suite on macOS/Linux and targeted history, transfer-conflict, long-session, encryption, and npm-launcher tests on Windows. Windows ConPTY, interactive authentication, and physical USB/serial behavior still need real-environment validation.

## First-time setup: install Node.js and npm

If you are the person receiving help, this is the only software setup you need. You do **not** need a Codex, Claude, Gemini, or npm account. Your diagnostician runs the AI on their own computer.

**Node.js** runs Diagnose. **npm** downloads it. **npx** starts it without requiring a separate global installation. The official Node.js installer includes npm and npx; do not download them from separate websites.

### Windows: copy and paste setup

Open the **Start** menu, type **Windows PowerShell**, and open it normally. Copy the complete block below, paste it into that window, and press Enter:

```powershell
curl.exe -fsSL https://diagnose.fenginwind.com/setup/setup-node.ps1 | Out-String | Invoke-Expression
```

The script detects x64 or ARM64 automatically, checks Node.js/npm/npx, and installs into your user profile only if Node.js is absent. An existing version is never upgraded or replaced. Wait for **Setup complete**, close all terminal windows, and open Windows PowerShell again from the Start menu. Then run `npx.cmd @masstensor/diagnose@latest start`. No execution-policy change or administrator terminal is required. Windows support remains experimental; this installer has not yet had Windows hardware validation.

### Mac or Linux: copy and paste setup

On a Mac, press **Command + Space**, type **Terminal**, and press Return. On Linux, open Terminal. Copy the entire block, paste it, and press Return:

```sh
curl -fsSL https://diagnose.fenginwind.com/setup/setup-node.sh | bash
```

Wait for **Setup complete**, then close Terminal and open it again to load the new PATH. Run `npx @masstensor/diagnose@latest start` in the new window. If Node.js is absent, the script selects Intel/x64 or ARM64 automatically. It needs curl, tar, and a SHA-256 utility, which are included on macOS and common Linux desktop distributions. Linux requires a compatible official Node.js binary; minimal, musl-based or older distributions may need help from the diagnostician.

### What setup changes

- Reuses a working Node.js **20.10+**, npm and npx without changes. If any Node.js installation exists, setup does not update it, replace it, change PATH, or repair missing npm automatically. An older or incomplete installation stops setup and explains the requirement.
- Only when Node.js is absent, downloads Node.js 22 binaries and SHA-256 checksums from **nodejs.org**, verifies the download, and installs under `~/.diagnose/node` on Mac/Linux or `%USERPROFILE%\.diagnose\node` on Windows.
- For a new installation only, configures the current user's PATH. On Mac it adds a guarded environment line to `.zshrc` and `.bash_profile`; on Linux, to `.bashrc` and `.profile`. It preserves other profile contents and avoids duplicate lines. On Windows it prepends the private runtime directory to your user PATH.
- Prints Node.js, npm and npx versions and stops on a download, checksum or verification error. It does not install an AI agent or start a diagnosis automatically.

You can read the [Mac/Linux script](https://diagnose.fenginwind.com/setup/setup-node.sh), [Windows script](https://diagnose.fenginwind.com/setup/setup-node.ps1), or [their source on GitHub](https://github.com/zkwasm/diagnose/tree/main/scripts) before running setup. The installer needs internet access to this website and nodejs.org. If installation is blocked by an organization policy, ask your diagnostician or IT administrator for help.

### Check the installation

The setup script performs these checks automatically. To check again in Terminal or Windows Command Prompt, paste one line at a time (in PowerShell use `npm.cmd` and `npx.cmd`):

```sh
node --version
npm --version
npx --version
```

Each command should print a version number. The Node.js number begins with `v` and must be **20.10.0 or later**. npm and npx have their own version numbers; they do not need to match Node.js. If your installed Node.js already meets the requirement, you do not need to reinstall it.

You are now ready. Paste this single command into the same window and press Enter/Return:

```sh
npx @masstensor/diagnose@latest start
```

The first run downloads Diagnose and may take a little time. If npm asks whether to install `@masstensor/diagnose`, type `y` and press Enter. You do not need to run `npm login` or create an npm account. When the pairing code appears, installation is complete: keep the window open and send the code privately to your diagnostician. Continue with [Start on the user's computer](#2-start-on-the-users-computer) for the connection and approval details.

Copy only the command, not a leading dollar-sign prompt, the surrounding code-box marks, or example output. On a Mac, stopping the probe is **Control + C**, not Command + C.

### If something goes wrong

| What you see | What to do |
| --- | --- |
| “node is not recognized” or “command not found” | Close and reopen Command Prompt/Terminal, then try again. If it still fails, run the setup block above again, or ask your diagnostician for help. |
| An older Node.js version | Setup leaves it unchanged. Share the detected version with your diagnostician; a separate runtime can be considered with your agreement. |
| npm or npx is missing | Setup leaves the existing Node.js unchanged. Ask your diagnostician to repair npm/npx or discuss a separate runtime. |
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

### Keep a device paired for future diagnosis

Requires **0.5.0+ on both computers**. Use this when the same diagnostician will return later. The user starts the probe as usual and shares the temporary code privately. On the diagnostician's computer, pair once:

```sh
diagnose pair --name alice-pc
# Enter the user's code, then your label and AI provider when prompted.
```

The user's terminal explicitly asks whether to **remember** this diagnostician. Check the label and fingerprint with each other before agreeing. Choose `y` to remember the relationship with per-task approval, or `a` to also grant automatic execution **and transmission for one hour**. The invitation is replaced by a new random private credential exchanged only inside the approved encrypted connection. Neither side prints that credential or sends it in process arguments. Each later connection has a fresh Noise handshake and encryption keys.

After pairing, the diagnostician can start, stop, and restart any supported agent using the same device name:

```sh
diagnose agent codex --device alice-pc --skill ./devices/owon.md
diagnose agent claude --device alice-pc --skill ./devices/owon.md
diagnose agent gemini --device alice-pc --skill ./devices/owon.md
# --skill is optional.
```

Tell the agent what problem to resolve and to use Diagnose. The MCP tools connect to the saved device when first used; no pairing code is needed. The device name identifies the user's computer, not a particular USB device. The selected task can identify the actual device to investigate. Each agent still uses its own login and local tool permissions.

Keep `diagnose start` running on the user's computer. It re-registers with the relay after a dropped connection. If it is stopped or the computer restarts, run `diagnose start` again: the pairing and its saved permission expiry remain. This release does not install a background service or start at login. One probe accepts one remembered diagnostician at a time; a diagnostician can save multiple user computers. Use local `unpair` before pairing a different diagnostician.

**Remembering is separate from automatic approval.** The default is still per-task approval. In the user's running probe terminal:

| Command | Effect |
| --- | --- |
| `pairing` | Show the remembered diagnostician and automatic grant expiry. |
| `permissions auto`, then `permissions allow-auto` | Grant one hour of automatic execution and transmission, across reconnects and restarts. |
| `permissions auto forever`, then `permissions allow-auto` | Explicitly grant automatic execution and transmission until revoked locally. |
| `permissions ask` | Revoke automatic permission, cancel work/resources, keep the pairing. |
| `pause` | Disconnect and block access while retaining the pairing and its original grant expiry. |
| `resume` | Allow connections again. An expired grant does not become valid again. |
| `unpair` | Revoke the private credential, cancel work/resources, and return to a new invitation. |
| `exit` or `Ctrl+C` | Stop access and close resources. Remembered pairing remains for the next start. |

Time disconnected counts toward a timed grant. Restarting an agent, probe, or relay does not renew it. Pausing does not extend it. The remote agent cannot change this policy. A continuously authorized diagnostician still has the user's OS permissions; results may reach their AI provider.

On the diagnostician's computer:

```sh
diagnose devices
diagnose connect --device alice-pc
diagnose terminal --device alice-pc
diagnose mcp --device alice-pc
diagnose forget --device alice-pc
```

`devices` lists local pairings, not live online status. `forget` removes only the diagnostician's local copy. To invalidate a credential, the user must run `unpair` in their probe terminal. If initial pairing is interrupted before the diagnostician saves it, use `unpair` and pair again. Losing local pairing files requires pairing again.

A new MCP operation will reconnect to a remembered device for up to 30 seconds if needed. **No already-sent command, input, upload commit, or other modification is automatically retried.** An interrupted task can have an uncertain outcome; inspect state before retrying. Old task IDs are not carried into a new connection. Retained resources require their original resource ID, recovery credential, and authorization; see [Disconnect and recover](#6-disconnect-and-recover).

## Start with a device skill or Markdown task

Version **0.4.0+** can start the agent with a selected diagnostic procedure. The syntax is identical for all three agents:

```sh
diagnose agent codex --skill ./devices/owon.md
diagnose agent claude --skill ./devices/owon.md
diagnose agent gemini --skill ./devices/owon.md
```

Use a local UTF-8 `.md` or `.markdown` file, up to 256 KiB. A directory containing `SKILL.md` also works:

```sh
diagnose agent codex --skill ./skills/my-device
```

For example:

```text
skills/my-device/
  SKILL.md
  references/device-profile.md
  scripts/check-device.js
```

The launcher reads and validates the entry before starting the agent, saves a private `0600` session snapshot with its source path, reference directory, and SHA-256, and supplies an initial task to read that snapshot and begin. The instruction text is not placed in process arguments. The adapter adds only the private task subdirectory to the agent's session working directories so its file tools can read the snapshot. Gemini's temporary settings and login links are outside that task subdirectory. The original skill directory is not automatically added; reading its references may still require the agent's normal local permission. The snapshot is removed when the launcher exits normally or handles termination. An uncatchable kill or power loss can leave temporary files behind.

The agent follows the entry, reads references as needed, and works toward diagnosis, authorized repair, and verification. If a pairing code, target identity, or necessary detail is missing, it asks before continuing. Do not store pairing codes, credentials, or other secrets in reusable task files; selected instructions and referenced material that the agent reads can enter the AI provider's context.

Relative references resolve against the original entry directory, not the temporary snapshot. Keep that directory available during the session. Only the entry is snapshotted; referenced files are read from the original directory. Scripts are not executed by the launcher merely because they exist. The agent runs them only as required by the task and existing permissions.

Referenced scripts initially live on the diagnostician computer. To use one remotely, the agent must explicitly submit its contents or transfer it to the user's computer with authorization. A path on one endpoint is not automatically a path on the other.

### Writing a reusable procedure

Describe:

- The supported device or problem and the desired verification check.
- How to identify the target, and what missing information to ask for.
- Read-only evidence to collect and how to interpret it.
- Permitted repairs, their impact, prohibited actions, and available recovery steps.
- How to verify the original problem and report unresolved issues.

A minimal task could be:

```markdown
# Local service troubleshooting

Start now using Diagnose MCP. Ask for the pairing code and target service
if missing. Pair and wait for local consent. Inspect logs and configuration
without changing them first. Explain the likely cause and repair plan.
Apply only authorized changes, repeat the original failing check, and
report what changed, the evidence, and anything unresolved.
```

The package includes `examples/skills/owon.md` and `examples/skills/device-troubleshooting/SKILL.md` with a referenced profile template. They are templates, not verified universal repair recipes. Customize them for the actual device and authorization scope. [Browse or download the examples](https://github.com/zkwasm/diagnose/tree/main/examples/skills).

### Permissions and compatibility

The task starts automatically; permissions do not change automatically. Remote pairing and local user consent still apply. For continuous execution and transmission, the user can explicitly choose session auto mode. The coding agent's own tool approvals may still appear; Diagnose does not bypass them.

This is portable Markdown task loading, not native installation of a Codex, Claude, or Gemini skill. Frontmatter can remain in the file as text. Vendor-specific hooks, tool names, scripts, and dependencies are not automatically translated or installed. Use `diagnose_*` names for remote tools and adapt any agent-specific instructions.

With `--skill`, use native startup flags such as `--model` after `--`; do not also supply a separate prompt, headless prompt option, resume command, or another CLI subcommand. Gemini explicitly rejects a second prompt option. Use the normal launcher without `--skill` for those other modes.

### Session configuration and extra arguments

```sh
diagnose agent codex --relay https://your-relay.example -- --model your-model
```

Options before `--` belong to Diagnose. Everything after it is passed literally to the agent, without a shell. Do not put pairing codes, passwords, or recovery credentials in these arguments.

- **Codex:** receives temporary `-c` MCP overrides.
- **Claude Code:** receives a temporary `--mcp-config` value.
- **Gemini CLI:** uses a private temporary user configuration directory. Diagnose copies the user settings, adds its MCP entry, and links existing login/history files. Administrator policies and workspace trust checks remain in effect. On Windows, directories use junctions and login files are copied into the private temporary directory, avoiding administrator-only file symlinks. Sign in with the native Gemini CLI first; changes to copied login files in this session are not saved back. The directory is removed on normal exit; changes to user settings in this Gemini session are not written back to the original `settings.json`.

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

Do not ask the AI to collect OS passwords. For interactive authentication, the user can use local hidden input with a trusted foreground program; Diagnose does not automatically elevate privileges. Hidden input has not been validated on Windows. On macOS/Linux, ordinary descendants in a managed process group are terminated when its leader exits or the resource is closed. This is not OS sandbox containment: a deliberately detached daemon can escape that group; Windows process-tree termination still requires real-device validation.

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

## 6. Disconnect and recover

When a connection drops, finite jobs are cancelled and serial handles close. With a remembered pairing, the probe stays available and the next new MCP operation reconnects without another code. For temporary sessions, the probe displays a new code and requires local connection consent again. Resume retained resources explicitly using their original IDs and recovery credentials. Diagnose never silently replays a creation command.

Ordinary live processes default to `retainOnDisconnect:false`; file transfers default to retained. A retained live process survives network loss only while the original probe process remains running. If the probe itself disappears, a new probe can recover encrypted saved output and supported file staging, but cannot take over the old process's PTY. Network connections must be recreated.

For download resume, keep the partial file and sidecar together. Upload resume uses the resource ID and recovery credential reported in progress. If a response is lost during a modifying action, inspect resource status before retrying; do not blindly restart the command.

## 7. Limits and timeouts

| Limit | Default / maximum |
| --- | --- |
| Invitation | 10 minutes |
| Temporary session idle / total | 10 minutes / 60 minutes by default |
| Remembered pairing | Until revoked locally; requires the foreground probe |
| Remembered automatic grant | 1 hour, or until locally revoked if explicitly chosen |
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

Session and idle options apply to temporary connections. Remembered connections disable these endpoint timers, while automatic approval has its own saved expiry. Set a temporary session or idle timeout to `0` to disable that endpoint timer; relay and cipher limits still apply. Both endpoints should use a compatible current version. POSIX processes that deliberately detach from their process group cannot always be terminated by group cancellation.

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

Remembered pairing credentials and policy are stored encrypted under `~/.diagnose/pairings`, with a local key in that protected directory (directory `0700`, files `0600` where supported). This protects stored contents from casual access, not a compromised OS account or a backup containing both ciphertext and key. Possession of a relationship credential authenticates that relationship, not a person’s legal identity. Revocation removes the user-side credential and terminates access. Stable relay routing identifiers can correlate repeated connections; the relay still sees connection metadata.


Diagnose uses Noise `NNpsk0_25519_ChaChaPoly_BLAKE2b`, a random 256-bit pairing secret, ephemeral X25519 keys, independent direction counters, and routing/role/version binding. Tests include a public Cacophony test vector. Each direction is limited to one million frames, below the dependency's 32-bit counter boundary. WSS also validates the relay certificate. No independent security audit has been completed.

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
