# Diagnose a remote device

Use this guide if a person on site has shared a nine-letter invitation. Choose the instructions for your existing agent, then describe what you need to verify on the device.

[All guide scenarios](../../USER_GUIDE.md)

## Choose how to start

- **Manual agent mode** is the easiest way to try Diagnose. Use the native skill below, or [launch an agent with Diagnose MCP](automation.md#launch-an-agent-with-diagnose-mcp). Give the agent the invitation and symptom in chat, then guide the investigation as it returns evidence.
- **Start with a device procedure** when you have steps you want the agent to follow at launch. [Load a Markdown file with `--skill`](procedures.md#start-with-a-device-skill-or-markdown-task). The on-site probe still controls permissions.

## Use Diagnose as a native agent skill

Install the skill once through your agent's GitHub installation flow. All three agents use the same `skills/connect/` directory in the repository. The helper runs Diagnose 0.8.0 locally on demand with `npx` and needs Node.js 20.10 or later. There is no separate global Diagnose CLI installation for this workflow.

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

Give the agent the invitation, device model, connection method, and symptom. The person on site confirms the connection if their startup mode requires it. The skill keeps the connection available for follow-up between messages. Ask the agent to close it when you are done, or have the on-site user stop the probe. See [session timeouts](automation.md#limits-and-timeouts) for details.

## From a reported problem to a verified result

For a device session, work toward an observable device outcome:

1. **Describe the problem.** Identify the device model, its connection to the on-site computer, what fails, and what you expected. Agree on the check that will show whether the problem is resolved.
2. **Investigate first.** Ask the agent to identify the available interface and tools, then inspect device logs, network responses, or other relevant evidence. Distinguish confirmed facts from possible causes.
3. **Review a repair plan.** Have the agent explain what it intends to change, why, the expected impact, and any recovery option. Where practical, preserve the original configuration before editing it.
4. **Apply authorized changes.** The agent can use commands, scripts, file edits, and device tools under the user's existing permission mode. Only proceed within the agreed scope.
5. **Verify the result.** Check the device itself: repeat the failing exchange, observe new readings, or run its supported health check. Ask for a summary of what changed, the verification evidence, and anything still unresolved. An executed command alone does not establish that the user's problem is fixed.

These are instructions for directing the agent, not a separate enforced plan-approval system. The [probe permissions](on-site.md#choose-and-change-permissions) still apply. Automatic mode continues to allow execution and transmission under the user's grant; general automatic rollback is not provided.

You can also request a read-only investigation and stop after the explanation. The on-site computer’s drivers, software, configuration, and network can also be investigated when they are part of the problem; successful fixes depend on the issue, available access, and the user's authorization.

The native skill supports temporary pairing and finite diagnostics, including serial operations. For remembered devices, live terminals, or cases, use the [agent launcher](automation.md#launch-an-agent-with-diagnose-mcp).
