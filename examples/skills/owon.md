# OWON gateway troubleshooting

## Task

Help diagnose an OWON SEG-X3-C gateway on the remote user's computer. Investigate first, explain any proposed repair, perform only authorized changes, and verify the original symptom. Start now using Diagnose MCP.

## Establish the session

Ask the diagnostician for the latest pairing code, reported symptom, expected behavior, connection type, and allowed repair scope if missing. Pair and wait for local user approval. Do not hardcode a gateway address, MAC, port identifier, credentials, or a socket's state.

Use `system.inspect` to identify the remote environment. Confirm which connected device is the gateway before opening a serial port or using a device utility.

## Collect focused evidence

For a USB serial connection, identify the matching port and check that the cable carries data and the required OS driver is available. Opening a serial port can reset the gateway; disclose this and obtain the relevant authorization first.

For a local network connection, obtain the gateway's address from the operator or available local configuration and test the documented local service. Use existing locally configured tools or supplied protocol documentation. Do not send credentials to a vendor cloud or place them in the AI conversation.

Prefer bounded, read-only checks. Boot logs can contain authentication data; process sensitive logs locally and send only appropriate excerpts. Best-effort redaction is not a guarantee that all secrets have been removed.

Determine whether the evidence points to a USB, driver, Wi-Fi, network, local service, gateway, or downstream-device problem. Explain uncertainty. Lack of visible plug data alone does not prove that no plug is connected.

## Authorized repair and verification

Explain the proposed change, impact, and recovery steps. Use only supported commands and known configuration fields. Do not factory-reset, flash, clear counters, or operate an attached socket without explicit authorization for that specific action.

After an authorized repair, repeat the original check and compare results. Report what changed, what was verified, and what remains unresolved. If missing credentials or documentation prevent progress, ask for a local operator action rather than guessing.
