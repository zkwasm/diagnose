# Diagnose user guide

Diagnose lets a remote AI agent inspect and troubleshoot a device through a computer on site. The person on site connects the equipment and controls access. The diagnostician runs the AI agent on their own computer. An encrypted relay connects the two computers.

## Choose your scenario

| If you want to… | Go to |
| --- | --- |
| Connect for the first time | [Quick start](#quick-start) |
| Get help with your device | [Receive remote help](docs/guide/on-site.md) |
| Use Claude Code, Codex, or Gemini to diagnose a device | [Diagnose a remote device](docs/guide/diagnose.md) |
| Reconnect without exchanging a new invitation | [Return to a saved device](docs/guide/reconnect.md) |
| Load a device procedure or learn from a completed diagnosis | [Reuse and improve procedures](docs/guide/procedures.md) |
| Start Diagnose from a script or use your own MCP client | [Automation and tool reference](docs/guide/automation.md) |
| Fix a setup problem, recover access, or review activity | [Troubleshoot and review a session](docs/guide/troubleshooting.md) |

## Quick start

### 1. Prepare both computers

If you already have Node.js 20.10 or later, npm, and npx, skip the installer. Otherwise, run the one-line setup command for your computer. It installs Node.js, npm, and npx when Node.js is absent and leaves existing installations in place.

**Windows:** open the Start menu, type **Windows PowerShell**, and open it. Paste:

```powershell
curl.exe -fsSL https://diagnose.fenginwind.com/setup/setup-node.ps1 | Out-String | Invoke-Expression
```

**Mac:** press **Command + Space**, type **Terminal**, and press Return. **Linux:** open Terminal. Paste:

```sh
curl -fsSL https://diagnose.fenginwind.com/setup/setup-node.sh | bash
```

Wait for **Setup complete** and three version numbers. Then close the terminal and open a fresh one before continuing, so a newly installed Node.js is available. On Windows, close all terminal windows and reopen Windows PowerShell from the Start menu. On Windows, use `npx.cmd` and `npm.cmd` wherever this guide says `npx` and `npm`; this avoids PowerShell script-policy errors without changing your security settings. See [setup details and troubleshooting](docs/guide/on-site.md#first-time-setup-install-nodejs-and-npm) if setup fails.

Only the **diagnostician** needs an installed, signed-in Codex CLI, Claude Code, or Gemini CLI. The person receiving help needs no AI account.

### 2. Connect the device and start the on-site probe

Ask the diagnostician which connection to use:

- **USB or serial:** connect the device to the on-site computer using the appropriate data cable or adapter. Install any required driver. A USB port may provide power only; the device must expose a usable interface.
- **Local network:** use a computer that can reach the device's network address and service. Provide any required device credentials through the agreed private or local method.

Then run this on the on-site computer:

```sh
npx @masstensor/diagnose@latest start
```

If npm asks to install the package, type `y`. In v0.8+, choose the [approval mode](docs/guide/on-site.md#start-the-probe) before sharing the invitation. Press Enter for review, `a` for automatic tasks and results, or `e` to also preapprove the connection. Keep this terminal open and share the nine-letter invitation privately.

### 3. Choose how to start the diagnosis

#### Manual agent mode (recommended for your first session)

Open the agent you already use and start the diagnosis in chat. You give the agent the invitation, describe the problem, and direct follow-up checks as results come in. A device procedure is optional.

If you [installed the native Diagnose skill](docs/guide/diagnose.md#use-diagnose-as-a-native-agent-skill), invoke `/diagnose:connect` in Claude Code, `$diagnose:connect` in Codex, or ask Gemini to use the `connect` skill. You can also launch an agent with Diagnose already configured by running:

```sh
npx @masstensor/diagnose@latest agent codex
# Or replace codex with claude or gemini.
```

In the agent conversation, provide the code, device model, connection method, and a concrete goal.

> Use Diagnose with invitation abc-def-ghi. An OWON SEG-X3-C gateway is connected to the on-site laptop by USB serial. Plug readings have stopped. Inspect the logs, explain any proposed repair, and check whether readings resume after an authorized change.

#### Start automatically with a device procedure

Use this when you have a Markdown procedure for a device or a recurring problem. Replace `./device.md` with the path to your own file:

```sh
npx @masstensor/diagnose@latest agent codex --skill ./device.md
# Or replace codex with claude or gemini.
```

The agent loads the procedure and starts working through it. If it needs an invitation, share it in the agent conversation. The same on-site permissions apply in both modes. See [how to prepare a device procedure](docs/guide/procedures.md#start-with-a-device-skill-or-markdown-task).

### 4. Approve, diagnose, and finish

Unless the on-site user chose **Approve everything**, they check the diagnostician's label and connection fingerprint before approving. The probe shows which permissions each choice grants. Auto approval covers both execution and result transmission. Commands run with the user's OS permissions, and results can reach the diagnostician and their AI provider.

Ask the agent to start with a read-only check, explain what it finds, and verify the original symptom after any authorized repair. See [what the skill can do](docs/guide/diagnose.md#what-the-native-skill-can-do) and [a worked diagnosis example](docs/guide/diagnose.md#from-a-reported-problem-to-a-verified-result).

The user can type `permissions ask` to revoke automatic approval or `exit` to stop access. See [how to review what was collected and sent](docs/guide/troubleshooting.md#review-local-history-and-clean-up).

## Requirements

The on-site computer must have a working connection to the target device, plus any drivers, credentials, or vendor utilities needed for the intended checks. Diagnose cannot bypass a missing interface or perform physical repairs.

Both computers need **Node.js 20.10 or later**, npm, an interactive terminal, and outbound access to the relay. The default relay is `https://diagnose.fenginwind.com`. No inbound port, router change, or SSH server is required.

For an AI session, the diagnostician must separately install and sign in to Codex CLI, Claude Code, or Gemini CLI. Diagnose does not install an agent, provide a model subscription, or change the agent's approval mode.

Use the latest package on both endpoints. macOS probes and the Linux relay have been tested. Windows coverage includes targeted automated tests. Interactive terminals, authentication, and physical USB/serial behavior on Windows still need real-environment validation.
