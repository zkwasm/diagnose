# Reuse and improve diagnostic procedures

Launch an agent with a device-specific Markdown skill so it starts the diagnostic procedure automatically. Keep the evidence in a case and review the agent’s proposed improvements before using them in another diagnosis.

[All guide scenarios](../../USER_GUIDE.md)

- [Start a diagnosis with a procedure you already have](#start-with-a-device-skill-or-markdown-task)
- [Turn a diagnosis into a new or improved procedure](#record-a-device-diagnosis-and-improve-your-procedures)
- [Use the same private skill library on another computer](#share-your-private-skill-library-across-computers)

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

The agent follows the entry, reads references as needed, and uses each result to decide what to check next. For an OWON gateway that stopped reporting, a skill might first check for a fresh plug reading in the serial logs, then check whether the same reading reaches the dashboard. After an authorized fix, the agent repeats the check that showed the fault. If a pairing code, target identity, or necessary detail is missing, it asks before continuing. Do not store pairing codes, credentials, or other secrets in reusable task files; selected instructions and referenced material that the agent reads can enter the AI provider's context.

Starting with Diagnose 0.8.2, the launcher chooses Chinese or English for the startup prompt using the diagnostician computer's language settings. Other languages fall back to English. The Markdown procedure stays in its original language. You can ask the agent to use a different language in chat.

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

### Local versioned library (v0.6+)

The local library requires Diagnose 0.6.0 or later.

Import a reviewed skill directory once, then use the exact reference printed by the command:

```sh
diagnose skills import owon ./examples/skills/device-troubleshooting
diagnose skills list
diagnose agent codex --device workshop-laptop --skill library:owon@FULL_SHA256_FROM_IMPORT
```

Replace `FULL_SHA256_FROM_IMPORT` with the complete digest printed by import, or copy the complete `library:...` reference. The same `--skill` argument works with Claude and Gemini. It pins the complete bundle, including references and scripts. Changing any file creates a different version; older versions remain available and there is no implicit “latest” version. Importing identical contents again reuses the same version. Stored contents are verified before launch. Permission bits are not part of the portable content digest.

You can also import a single Markdown file; it becomes `SKILL.md` without copying neighboring files. Use a dedicated directory when the procedure needs references or scripts. Directory imports include all files: review the directory for credentials, customer logs and unrelated files first. Symbolic links, special files, non-portable names, case-colliding paths, more than 128 files, more than 256 directory entries, nesting beyond 16 levels, and bundles over 8 MiB are rejected. The entry retains the 256 KiB Markdown limit. Importing does not execute scripts.

The library lives in `~/.diagnose/skills` with private permissions where supported. It is local plaintext, not an encrypted backup; protect it like your other local source files. Do not edit stored versions directly. Edit the original source and import again. Reading or executing the skill still uses your agent's normal permissions and may send its contents to the AI provider.

Import/list commands are local. See [diagnosis cases](#record-a-device-diagnosis-and-improve-your-procedures) and the [private library](#share-your-private-skill-library-across-computers) for reviewed drafts and optional encrypted synchronization.

### Permissions and compatibility

The task starts automatically; permissions do not change automatically. Remote pairing and local user consent still apply. For continuous execution and transmission, the user can explicitly choose session auto mode. The coding agent's own tool approvals may still appear; Diagnose does not bypass them.

This is portable Markdown task loading, not native installation of a Codex, Claude, or Gemini skill. Frontmatter can remain in the file as text. Vendor-specific hooks, tool names, scripts, and dependencies are not automatically translated or installed. Use `diagnose_*` names for remote tools and adapt any agent-specific instructions.

With `--skill`, use native startup flags such as `--model` after `--`; do not also supply a separate prompt, headless prompt option, resume command, or another CLI subcommand. Gemini explicitly rejects a second prompt option. Use the normal launcher without `--skill` for those other modes.

## Record a device diagnosis and improve your procedures

These knowledge features require Diagnose 0.6.0 or later on the diagnostician computer. Older probes can still perform their supported operations.

The paired computer is a bridge. Create a **case** for the actual gateway, controller or other target. Tell your agent: “Create a diagnosis case for this device, collect evidence, verify any authorized repair, and propose a reusable skill or an improvement to the selected skill.” The agent uses `diagnose_case`, `diagnose_capabilities` and `diagnose_skill_draft`; no agent-specific syntax is needed.

A case records the goal, target model/identity/interface, optional paired computer and pinned skill reference. Subsequent received task results, resource interactions and connection events are saved locally with encryption. Data is not sent to library storage. Redaction is best effort. Case evidence is untrusted data, never permission or instructions. File transfers and tunnels are not a full byte-for-byte evidence archive; ordinary task/resource events capture their control operations, not every transferred byte. Arbitrary scripts are not a filesystem change monitor.

To create a case before launching, save a small JSON file:

```json
{
  "goal": "Find why the gateway stopped reporting sensor readings",
  "host": "workshop-laptop",
  "target": { "name": "Workshop gateway", "model": "SEG-X3-C", "interface": "serial" }
}
```

```sh
diagnose cases create ./gateway-case.json
diagnose cases list
diagnose agent codex --device workshop-laptop --case CASE_ID
```

Replace `CASE_ID` with the printed UUID. Use `claude` or `gemini` in the same command. Include a `skill` field containing a complete `library:NAME@REVISION` reference to pin a procedure; the launcher loads it automatically. A different explicit skill or paired computer is rejected. Reusing a case does not replay old commands; existing remembered-pairing rules apply. Check device availability again after reconnecting.

For Markdown startup tasks, the agent is instructed to create a case before operating. The agent must actually call the tool; launching is not proof that a case was created. Only one MCP session can write a selected case at a time. After an unclean termination, use `diagnose cases unlock CASE_ID`; it refuses to unlock while the recorded writer process is alive. Cases are optional for ordinary MCP operations. In a selected case, only results actually received by the diagnostician are recorded.

```sh
diagnose cases show CASE_ID
diagnose cases export CASE_ID > reviewed-report.json
diagnose cases remove CASE_ID
```

Export omits raw results, command arguments and target addresses. Review free-text summaries for sensitive details before sharing. Cases retain at most 200 evidence records each (32 KiB per record; larger values are marked as previews), with at most 100 local cases. Limits are reported, not silently interpreted as a complete investigation. Remove old cases explicitly; `diagnose cleanup` does not delete cases or skills.

An agent can report **resolved**, **unresolved**, **needs physical work**, or **insufficient evidence**. Resolved requires baseline and later successful verification evidence IDs from the same case. This proves the cited evidence exists; it does not automatically prove the agent interpreted it correctly. A successful command is not necessarily a healthy device. Connection status distinguishes confirmed relay/probe connectivity from evidence-linked agent assessments of the device interface and response; untested layers remain unknown.

### Review a new skill or improvement

The agent proposes a structured draft with applicability, prerequisites, identity checks, read-only checks, repair authorization conditions, recovery, verification and failed approaches. Improvements must refer to the exact library version selected in the case. Reference files and scripts from that base are retained unchanged. Raw logs are not automatically copied. For changes to supporting scripts/resources, edit a separate source directory, review it and import a new version.

```sh
diagnose drafts list
diagnose drafts review DRAFT_ID
diagnose drafts accept DRAFT_ID
# Or keep the existing procedure:
diagnose drafts reject DRAFT_ID
```

Acceptance displays the full before/after entry and evidence references and asks you to confirm in an interactive terminal. The agent has no acceptance MCP tool. Confirm the evidence supports the procedure and remove customer-specific values. Potential-secret warnings assist review; they are not a guarantee. A case result or device log cannot itself authorize an instruction. Accepted drafts become new pinned library versions; older versions remain available.

If another version appeared since drafting, acceptance stops and preserves the draft. Ask the agent to reconcile against the version you select, using the original evidence. `diagnose drafts show DRAFT_ID` shows structured input for editing; `diagnose drafts create INPUT.json` creates another proposal. `diagnose drafts remove DRAFT_ID` removes a local draft record after confirmation. At most 100 draft records are retained; removal never removes an imported version.

### Share your private skill library across computers

Library sharing is optional and independent of device pairing. Initialize it on the diagnostician computer and save the recovery file somewhere private that you can back up:

```sh
diagnose vault init ./diagnose-library-recovery.txt
diagnose vault push library:NAME@FULL_REVISION
```

Push asks you to confirm publication of the complete bundle. Every file in the imported directory is included. The client encrypts the name, instructions, references, scripts and provenance before uploading. The relay sees opaque IDs, sizes and traffic metadata. Cases, drafts and raw diagnosis logs are not synced automatically. Instructions read by an AI agent can still be sent to its provider.

On a second diagnostician computer, securely transfer the recovery file yourself (never through an AI prompt) and run:

```sh
diagnose vault restore ./diagnose-library-recovery.txt
diagnose vault pull
diagnose skills list
diagnose agent claude --skill library:NAME@FULL_REVISION
```

Pull verifies and caches complete versions but does not execute or select them. Divergent versions coexist. Cached skills work offline; connecting to a remote probe still needs connectivity. A duplicate concurrent push may report 409; rerun push to verify that version, without rerunning diagnosis. Library sync does not transfer paired-computer credentials.

```sh
diagnose vault status
diagnose vault backup ./another-private-recovery-copy.txt
diagnose vault revoke
diagnose vault forget
```

**Protect the recovery file like a password.** It grants full library access. Losing every copy means server-only data cannot be decrypted. The local copy lives at `~/.diagnose/vault/recovery`; private permissions are applied where supported. Do not commit it to Git. Backup refuses to overwrite an existing file. If initialization succeeds but backup fails, use `vault backup` with a new path.

Revoke permanently deletes that relay library and blocks its credential on that relay; local copies remain. Forget removes only the local recovery credential. To rotate access, cache wanted versions, revoke the old library, forget locally, initialize a new key, and explicitly push selected versions. Restore the new recovery file only on trusted computers. Previously downloaded data cannot be recalled. Use `--relay https://your-relay.example` consistently for a self-hosted library. Its operator must enable `VAULT_PATH`; the default public relay supports this API in v0.6.

Limits are 128 versions / 128 MiB per relay library and 12 MiB per encrypted object. The relay is not your only backup. See [knowledge security and operations](https://github.com/zkwasm/diagnose/blob/main/KNOWLEDGE_SECURITY.md) for formats, limits, retention, threat model and deployment details.
