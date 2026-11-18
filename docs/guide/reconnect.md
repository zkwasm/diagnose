# Return to a saved device

Use remembered pairing for repeated visits to the same on-site computer. The person on site approves the relationship and can pause or revoke it later.

[All guide scenarios](../../USER_GUIDE.md)

## Keep a device paired for future diagnosis

Requires **0.5.0+ on both computers**. Use this when the same diagnostician will return later. The user starts the probe as usual and shares the temporary code privately. On the diagnostician's computer, pair once:

```sh
diagnose pair --name workshop-laptop
# Enter the user's code, then your label and AI provider when prompted.
```

The user's terminal explicitly asks whether to **remember** this diagnostician. Check the label and fingerprint with each other before agreeing. Choose `y` to remember the relationship with per-task approval, or `a` to also grant automatic execution **and transmission for one hour**. The invitation is replaced by a new random private credential exchanged only inside the approved encrypted connection. Neither side prints that credential or sends it in process arguments. Each later connection has a fresh Noise handshake and encryption keys.

After pairing, the diagnostician can start, stop, and restart any supported agent using the same device name:

```sh
diagnose agent codex --device workshop-laptop --skill ./devices/owon.md
diagnose agent claude --device workshop-laptop --skill ./devices/owon.md
diagnose agent gemini --device workshop-laptop --skill ./devices/owon.md
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
diagnose connect --device workshop-laptop
diagnose terminal --device workshop-laptop
diagnose mcp --device workshop-laptop
diagnose forget --device workshop-laptop
```

`devices` lists local pairings, not live online status. `forget` removes only the diagnostician's local copy. To invalidate a credential, the user must run `unpair` in their probe terminal. If initial pairing is interrupted before the diagnostician saves it, use `unpair` and pair again. Losing local pairing files requires pairing again.

A new MCP operation will reconnect to a remembered device for up to 30 seconds if needed. **No already-sent command, input, upload commit, or other modification is automatically retried.** An interrupted task can have an uncertain outcome; inspect state before retrying. Old task IDs are not carried into a new connection. Retained resources require their original resource ID, recovery credential, and authorization; see [Disconnect and recover](troubleshooting.md#disconnect-and-recover).
