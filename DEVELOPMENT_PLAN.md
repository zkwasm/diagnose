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
- AWS, GitHub CI and npm publication: final release verification pending.

The first release deliberately retains explicit pinned revisions, a personal capability-based library, human draft review, and agent-assessed device status. Team roles/public catalogs, automatic rollback, native agent skill installation, proof of inventory freshness, and an independent security audit are outside this plan.
