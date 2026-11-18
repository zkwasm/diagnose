# Diagnose a remote device

Use this guide if a person on site has shared a nine-letter invitation. Choose the instructions for your existing agent, then describe what you need to verify on the device.

[All guide scenarios](../../USER_GUIDE.md)

## Choose how to start

- **Manual agent mode** is the easiest way to try Diagnose. Use the native skill below, or [launch an agent with Diagnose MCP](automation.md#launch-an-agent-with-diagnose-mcp). Give the agent the invitation and symptom in chat, then guide the investigation as it returns evidence.
- **Start with a device procedure** when you have steps you want the agent to follow at launch. [Load a Markdown file with `--skill`](procedures.md#start-with-a-device-skill-or-markdown-task). The on-site probe still controls permissions.

## Use Diagnose as a native agent skill

Install the skill once through your agent's GitHub installation flow. All three agents use the same `skills/connect/` directory in the repository. The helper runs Diagnose 0.8.1 locally on demand with `npx` and needs Node.js 20.10 or later. There is no separate global Diagnose CLI installation for this workflow.

### Claude Code

In Claude Code 2.1.275 or later, enter:

```text
/plugin install diagnose --marketplace zkwasm/diagnose
```

Choose the installation scope. Open a new session, or use `/reload-plugins` in the current one. Invoke `/diagnose:connect` with the private invitation and, if known, the device and symptom. [Claude Code plugin documentation](https://code.claude.com/docs/en/discover-plugins#add-a-marketplace-and-install-in-one-command)

### Codex CLI

In your terminal, run:

```sh
codex plugin marketplace add zkwasm/diagnose
codex plugin add diagnose@diagnose
```

Alternatively, add the marketplace and install Diagnose from `/plugins`. Open a new session and invoke `$diagnose:connect` with your private invitation. [Codex CLI plugin documentation](https://learn.chatgpt.com/docs/cli/reference#codex-plugin)

### Gemini CLI

In your terminal, run:

```sh
gemini skills install https://github.com/zkwasm/diagnose.git --path skills/connect
```

Approve the installation prompt. In a new session, ask Gemini to use the `connect` skill and provide the invitation. Use `/skills reload` if a Gemini session is already open. [Gemini CLI Skills documentation](https://geminicli.com/docs/cli/skills/#managing-skills)

## Run a diagnostic session

Give the agent the invitation, device model, connection method, and symptom. During pairing, the helper reports when it reaches the relay, authenticates the on-site probe and waits for acceptance, and confirms the pairing. The person on site approves the connection if prompted. When the agent's shell tool streams output, it can share these updates while pairing is still in progress.

After pairing, look for three separate results:

1. **Probe connected.** The agent can submit permitted checks on the on-site computer.
2. **Device interface identified.** The agent has evidence for which port or interface belongs to the device. If several ports could match, it asks you to confirm before opening one.
3. **Device response observed.** The agent reports a recognizable log line, a status reply, or another observation attributable to the device. A silent capture leaves this step unconfirmed.

The agent explains what it found in the first check and what it will check next. The skill keeps the connection available for follow-up between messages. Ask the agent to close it when you are done, or have the on-site user stop the probe. See [session timeouts](automation.md#limits-and-timeouts) for details.

## What the native skill can do

The agent uses these operations on the **on-site computer** through the probe. To reach the device, it uses the serial interface or an available device utility on that computer.

| What you can ask the agent to do | Operation |
| --- | --- |
| Report the on-site OS, processor architecture, available shells and tools, and visible serial ports. | `system.inspect` |
| Find a known log or configuration file, inspect its metadata, and read the relevant contents. | `file.list`, `file.stat`, `file.read` |
| Capture output from a confirmed serial port at the device's baud rate. | `serial.capture` |
| Send a documented request to the device over serial and read its reply. | `serial.exchange` |
| Run a shell command or installed program on the on-site computer, such as a vendor utility that reports device status. | `process.run` |
| Apply an authorized configuration edit to a file on the on-site computer. | `file.write` |

The agent submits one operation with `diagnose_start` or groups related operations with `diagnose_batch`. It uses `diagnose_wait` to get the result and `diagnose_cancel` to request cancellation of work in progress. Cancellation does not undo changes already made. You can describe the check in plain language. The agent selects the operation and waits for any approval the probe requires.

For a quick first check, ask “Use Diagnose to identify the on-site operating system, available shell, and visible serial ports.” `system.inspect` also collects the hostname, user paths, and network interfaces. In review mode, the on-site user reviews the collected report before sending it. A serial port listing gives the agent candidates to confirm with the person on site.

The native skill supports temporary pairing and finite operations. For live terminals, file transfers, remembered pairings, or case management, [launch the agent with Diagnose MCP](automation.md#launch-an-agent-with-diagnose-mcp). A [device procedure](procedures.md#start-with-a-device-skill-or-markdown-task) can tell the agent which checks and verification steps to use for a particular model.

### Run a shell command on the on-site computer

Ask in chat, for example, “Use Diagnose to check the working directory on the on-site computer and show me the result.” The agent submits `process.run` through the probe and waits for the exit status, standard output, and standard error.

For shell syntax such as pipes and conditionals, the agent names the shell explicitly. On macOS or Linux, `process.run` can launch `/bin/sh` with `[-c, pwd]`. On Windows, it can launch `powershell.exe` with `[-NoProfile, -NonInteractive, -Command, Get-Location]`. The agent can also call an installed program directly with an executable and an argument list. Commands follow the probe's execution and result-sharing permissions.

## From a reported problem to a verified result

Start with the actual symptom, where the device is connected, and what you need to see working. Have the agent collect read-only evidence and explain the next check. For a proposed change, ask what it will affect and how to restore the original setting. The [probe's permissions](on-site.md#choose-and-change-permissions) govern execution and result sharing. Repeat the original check after an authorized repair and ask the agent to summarize the result.

The [diagnostic walkthroughs](examples.md) show this conversation for a USB gateway, a network device, a factory data collector, and an application on the on-site computer. Each includes a prompt you can adapt and examples of how to follow the evidence.
