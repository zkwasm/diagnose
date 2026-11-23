# Device diagnosis and reusable knowledge

Status: all four implementation milestones completed for 0.6.0; release/deployment verification is tracked below.

## Product outcome

An on-site computer gives an authorized AI diagnostician access to an external device. Each investigation should leave evidence of its outcome and, when useful, a reusable procedure. The same procedure should work from another diagnostician computer without transferring customer logs or device pairing credentials.

## Assumptions

- Existing remote execution, transport and local approval remain the authority for device actions. A skill never grants permission.
- Local use works without an account or relay storage. Cloud synchronization is optional.
- Private skills may contain commercially sensitive instructions. Relay storage must be client-encrypted, including names and references.
- Session evidence is local by default. Publishing knowledge is a separate, explicit action.
- First release supports a personal library; team roles and public catalogs are later work.

## 1. Local versioned skill library — implemented

Import a Markdown file or a complete skill directory, including references and scripts. Address each version by a content digest. Preserve old versions; never silently select a different revision. Existing file-based launch remains supported across Codex, Claude and Gemini.

Acceptance: nested resources survive import; imports do not execute scripts; changed resources produce a new version; old versions still load; duplicate imports are idempotent; invalid paths, symlinks, excessive bundles and modified stored files fail validation. CLI output provides the exact launch reference.

Implemented: `diagnose skills import`, `diagnose skills list`, and `--skill library:NAME@REVISION` for all three agent launchers. Local tests cover version retention, integrity checks, concurrent duplicate imports, size/file-count limits and launcher integration. Type checking and site checks pass. Cross-platform CI includes the library and knowledge workflow tests. See release validation below for observed environments.

## 2. Target and evidence records — implemented

Separate the paired on-site computer from the device being investigated. A case records the goal, device model/identity, interface, selected skill revision, task IDs, observations, approved changes, verification and unresolved questions. Record only results actually received by the diagnostician. Allow an explicit outcome of unresolved, needs physical work, or insufficient evidence.

Add a tool for querying operation schemas/examples before execution. Start discovery with existing low-interference inspection; network scans, serial writes and repairs retain normal approval. Connection status distinguishes relay, probe, device interface and device response.

Acceptance: a gateway case points to the gateway rather than its host alias; disconnect/reconnect does not turn an interrupted repair into an automatic retry; a success report links the original failure to a subsequent verification result. Exports omit credentials and raw evidence by default.

## 3. Learn from a diagnosis — implemented

An agent proposes either a new skill draft or a revision based on the exact skill used. Keep observations and untrusted device output separate from instructions. Drafts include applicability, prerequisites, identity checks, read-only checks, repair conditions, recovery steps, verification, failed approaches and supporting case/task references. Parameterize device addresses and customer-specific values.

Show a diff and evidence to the diagnostician before accepting a version. If the base changed, retain both drafts and require reconciliation. An agent proposal must not silently replace an accepted skill. Secret detection assists review but is not a guarantee of sanitization.

Acceptance: a real read-only OWON investigation can produce a reviewed reusable draft without pairing codes or raw logs; an improvement preserves its base revision; rejected drafts do not affect launch; conflicting edits remain recoverable. Hardware writes require a separate justified test.

## 4. Optional encrypted personal library — implemented

Design a library identity independent from probe pairing. A new computer imports a recovery credential, retrieves ciphertext, authenticates and decrypts locally, then uses the same local versioned loader. Include complete bundles and encrypted manifests. Review key derivation, authenticated encryption, authentication, key recovery and revocation before implementation. Explain that losing all recovery credentials loses access to encrypted data.

Relay requirements: persistent storage, authenticated writes, size and rate limits, atomic revision publication, conflict detection, deletion and backup policy. No raw case history is synchronized by default. Retain divergent versions rather than last-writer-wins overwrites. Cache verified versions for offline use; downloading never executes a skill.

Acceptance: two isolated clients can sync and launch the same version; the relay cannot read names or contents; wrong keys and modified ciphertext fail; interrupted upload never publishes a partial version; concurrent edits are retained; device pairing credentials cannot access a library. Deploy to the existing AWS relay only after these checks pass.

## Release and documentation

Ship each completed milestone with English CLI help, guide examples and tests. Mark unreleased commands clearly until npm publication. Update the landing page when a complete user workflow is available, not when a roadmap item is merely planned. Preserve Node.js 20.10 compatibility and verify relevant Windows/macOS/Linux behavior. Avoid requiring connected hardware for library tests.

## Release validation

- Full initial regression: 85 passing tests on macOS/Node 22.
- Final knowledge/MCP checks: 8 passing tests, including interrupted upload and quota checks.
- Final launcher checks: 19 passing tests, including all three agents with a selected case and pinned skill.
- Node.js 20.10: 30 knowledge, library, MCP and launcher checks passed.
- Physical user-identified OWON SEG-X3-C: two authorized read-only serial captures received 20,293 and 18,992 bytes. Encrypted local case and a pending reviewed draft were produced; no serial command or raw-log publication occurred. This verifies log transport, not device health.
- English guide, landing page, CLI help and security/operations document updated. Site link, anchor and interaction checks pass.
- AWS relay and website deployed. Two isolated clients completed an HTTPS encrypted-library roundtrip and revoked the synthetic library. Existing Noise diagnostic sessions were also verified through the public relay.
- Windows/macOS/Linux CI passed after fixing Windows concurrent-directory publication and a nonportable test filename. Final single-writer case protection passed 28 local tests and is included in the next CI run.
- npm publication awaits official account verification.

The first release deliberately retains explicit pinned revisions, a personal capability-based library, human draft review, and agent-assessed device status. Team roles/public catalogs, automatic rollback, native agent skill installation, proof of inventory freshness, and an independent security audit are outside this plan.

## 0.7 invitation usability

Implemented nine-letter invitations with a 30-minute deadline, OPAQUE endpoint authentication, local consent, independent endpoint attempt limits, and unchanged high-entropy remembered credentials. Session idle/lifetime clocks now begin after pairing. Legacy D1 invitations remain accepted. See PAIRING_PROTOCOL.md for the design, entropy accounting and rollout requirements. The previously pending 0.6 features are included in this release; npm 0.6 publication was not completed.

## Field workflow after the Argentina CT meter session

An on-site user should be able to install and open Probe, send one code, then follow simple instructions while the diagnostician's agent runs several rounds of checks through the on-site computer. Field testing reached the OWON gateway through USB. Preparing Node.js, recovering from unstable Wi-Fi and interpreting terminal output took time away from the device investigation.

The 0.8.5 implementation covers approval selection and switching, readable task states, temporary resume, case-based agent restart, serial readiness and read-only USB reattachment. Core probe controls support English, Simplified Chinese and Spanish. The Windows x64 desktop app has an offline-installer build and a CI smoke test. Public Windows distribution requires signing and an on-site USB acceptance run. Equivalent desktop packages for macOS and Linux are separate platform work.

### 1. Session permissions and useful progress

- **On-site consent.** For a fresh one-time invitation, show automatic approval for the session as the default selection. The user confirms before the invitation appears. Explain that the recipient can connect with the code, run approved session capabilities with the local user's permissions, and receive results. Offer manual review in the same screen. A new invitation or remembered pairing has its own consent.
- **Switch during review.** Every execution and transfer prompt offers approval once, automatic approval for the rest of the current session, rejection and details. The user can revoke automatic approval or end access from the same screen. Record permission changes and keep the operation and result details in local history.
- **Readable status.** Both ends show the current step in plain language, for example waiting for approval, capturing gateway logs, sending results, waiting for the on-site user, or reconnecting. Show a short outcome and the next action. Keep commands, technical metadata and raw results on demand. Preserve structured output for CLI and MCP automation.
- **Acceptance.** A field participant can explain who gains access and when it ends, switch modes during either review stage, and find the record of what ran, what was sent and what changed. Cancelling access ends outstanding work and closes live channels. A short summary identifies a failed action and where to find its details.

### 2. One diagnostic session across network interruptions

- **Session lifetime.** The current two-hour invitation is for first pairing. After pairing, keep the logical session open across several agent turns, tasks and on-site actions. Reset the six-hour idle clock on authenticated user or diagnostician activity. Transport keepalives do not reset it. On-site termination or revocation takes effect immediately, including while offline.
- **Resume.** On transient transport loss both endpoints retry with bounded backoff. Resume the same logical session with a high-entropy, session-bound credential issued through the authenticated channel, mutually authenticate and use fresh transport keys. Recover after a relay restart or a diagnostician agent restart within the same validity window. Keep the current permission scope. Local Probe exit ends access. Remembered pairing retains its separate enrollment and revocation rules.
- **Task state.** Use a stable request ID across reconnects. Show whether a task was queued, running, awaiting transfer, completed or has an unknown result. Deliver already-authorized saved results where available. Do not rerun a command or a write when its outcome is uncertain. Recheck state and obtain a new decision before retrying a state-changing operation. Keep an explicit local disconnect distinct from loss of network.
- **Acceptance.** Pair once, perform three diagnostic rounds, interrupt Wi-Fi before and during a task, restart the relay and restart the diagnostician agent. Each valid resume uses the original session. No task runs twice. Revoked and expired sessions cannot resume. Older clients continue to pair under their current protocol during rollout.

### 3. Independent Probe desktop app

- **Windows first.** Publish a signed installer for supported Windows systems, followed by a signed and notarized macOS build and a Linux package based on field demand. Bundle the runtime and required native modules. The on-site user downloads, installs and opens Probe through the normal OS interface. Include an offline-installable build and an integrity check for downloads. Preserve the existing CLI and npm distribution for automation and technical users.
- **First screen.** Guide the user through language, connection permission, a visible code with a Copy button, connection status, any physical action requested by support, and an End session button. Run under the user's account. Do not start background access at login by default.
- **Shared implementation.** Reuse the same transport, task engine, permission decisions and encrypted local audit as the CLI. Separate the on-site UI from the engine behind a narrow local interface. Evaluate installer size, native serial support, signing and update behavior before selecting desktop packaging. Avoid a second protocol or a separate diagnoser product.
- **Acceptance.** On a clean Windows computer with no Node.js or npm, install offline once the package is downloaded, open it from the Start menu, copy a code, capture from a USB gateway and end access. An interrupted download can be retried without a partial installation. Repeat the launch and native USB tests on each supported platform before publishing its installer.

### 4. Language and device handoffs

- **Languages.** Start with English, Simplified Chinese and Spanish. Use the OS language as the initial selection where supported, let each side change its display language independently, and remember the choice locally. Localize setup, permissions, connection status, errors and on-site instructions from the diagnostician. Raw evidence stays in its original language.
- **Physical steps.** Support an explicit on-site instruction during the same session. In a USB capture, the user sees when capture is ready and when to restart the gateway. When a serial device disappears, show that Probe is waiting for it to reappear. Let the diagnostician correlate attach events, logs and device identifiers, including different byte orders for the same Zigbee address.
- **Evidence.** Distinguish a gateway cloud connection, a meter joined to the gateway, and a confirmed meter reading delivered upstream. Report each claim with its own evidence and mark unverified steps.
- **Acceptance.** On a Spanish-language Windows computer, an on-site user can install without terminal commands, follow a USB restart instruction and end the session. Run the diagnostic side in English during the same session. Verify translated core prompts in all three languages and compare the captured gateway and meter IDs against published device labels.

### Implementation and rollout

1. Simplify manual review prompts and activity output. Add an integration test for viewing details, granting session approval during review and running a second task over the same connection.
2. Complete the startup permission selection and task status messages. Add authenticated session resume, task recovery and revocation tests before deploying a relay update. Verify mixed versions and intentionally interrupted sessions on Windows and macOS.
3. Make on-site prompts reusable across the CLI and app. Add the three languages and validate the USB handoff on a real gateway. Build the signed Windows installer against this shared implementation and test it on a clean machine.
4. Update Quick Start, the landing page and the demonstration after the corresponding workflow ships. Repeat the field scenario with nontechnical users, a Spanish UI and a deliberately unstable connection.
