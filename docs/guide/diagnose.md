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
| Identify the on-site OS and list visible serial ports. | `system.inspect` |
| Find a known log or configuration file, inspect its metadata, and read the relevant contents. | `file.list`, `file.stat`, `file.read` |
| Capture output from a confirmed serial port at the device's baud rate. | `serial.capture` |
| Send a documented request to the device over serial and read its reply. | `serial.exchange` |
| Run a shell command or installed program on the on-site computer, such as a vendor utility that reports device status. | `process.run` |
| Apply an authorized configuration edit to a file on the on-site computer. | `file.write` |

The agent submits one operation with `diagnose_start` or groups related operations with `diagnose_batch`. It uses `diagnose_wait` to get the result and `diagnose_cancel` to request cancellation of work in progress. Cancellation does not undo changes already made. You can describe the check in plain language. The agent selects the operation and waits for any approval the probe requires.

The native skill supports temporary pairing and finite operations. For live terminals, file transfers, remembered pairings, or case management, [launch the agent with Diagnose MCP](automation.md#launch-an-agent-with-diagnose-mcp). A [device procedure](procedures.md#start-with-a-device-skill-or-markdown-task) can tell the agent which checks and verification steps to use for a particular model.

### Run a shell command on the on-site computer

Ask in chat, for example, “Use Diagnose to check the working directory on the on-site computer and show me the result.” The agent submits `process.run` through the probe and waits for the exit status, standard output, and standard error.

For shell syntax such as pipes and conditionals, the agent names the shell explicitly. On macOS or Linux, `process.run` can launch `/bin/sh` with `[-c, pwd]`. On Windows, it can launch `powershell.exe` with `[-NoProfile, -NonInteractive, -Command, Get-Location]`. The agent can also call an installed program directly with an executable and an argument list. Commands follow the probe's execution and result-sharing permissions.

## From a reported problem to a verified result

Suppose plug readings stopped arriving from an OWON gateway connected by USB serial. Start with a prompt like this:

> The OWON gateway stopped reporting plug readings. Start with read-only checks. Confirm which serial port belongs to the gateway, look for recent readings or errors, and tell me what the evidence supports. Ask before changing anything. We’ll consider it fixed when fresh readings appear again.

1. **Identify the interface.** The agent can list serial ports with `system.inspect`. If several ports match, confirm the right one and the baud rate with the person on site before opening it.
2. **Collect a baseline and follow the evidence.** Use `serial.capture` for a short sample. If the sample is silent, check whether the port, baud rate, or cable is correct. If the gateway responds but readings are still absent, inspect the relevant collector logs with `file.read` if available. Reuse the same session to ask for another check.
3. **Review one proposed change.** If the evidence points to a setting, ask the agent to show the current value, explain the proposed edit, and describe how to restore the original value. The [probe's permissions](on-site.md#choose-and-change-permissions) govern execution and result sharing. You can end the diagnosis after the read-only findings.
4. **Repeat the original check.** After an authorized repair, use the same capture or status check to look for fresh readings. If they are still missing, use that result to choose the next check. Ask the agent to summarize the evidence, changes, and any remaining uncertainty.

Tell the agent when to stop. The on-site user can also end access from the probe terminal. Use the same workflow for a problem on the on-site computer itself. Pick a check that measures whether the original symptom is gone, such as a successful application start or a working device connection.
