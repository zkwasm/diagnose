# Receive remote help

Use this guide if you are at the device and a diagnostician is helping remotely. You need the on-site computer, a working connection to the device, and the Diagnose probe.

If Node.js, npm, and npx are already installed, go straight to [Start the probe](#start-the-probe).

[All guide scenarios](../../USER_GUIDE.md)

## Windows desktop preview

The Windows x64 preview bundles the runtime and serial support. It installs for your Windows account and opens from the Start menu as **Diagnose Probe**. Pick a language, select **Start support**, review the permission choices and copy the one-time code. Keep the app open while the diagnostician works. Select **Require review** to revoke automatic approval or **End access** to stop the session.

The unsigned installer from [GitHub Actions](https://github.com/zkwasm/diagnose/actions/workflows/test.yml) is a test build. A public download still needs signing and a clean Windows test with a physical USB device.

## macOS and Linux desktop previews

For macOS 13 or later, use the DMG that matches your processor, Apple Silicon or Intel. Open the image and drag **Diagnose Probe** into Applications. The CI previews are for development. Public downloads require Apple Developer ID signing and notarization.

On Ubuntu 22.04 or later or Debian 12 or later, install the matching `.deb` and open **Diagnose Probe** from the applications menu. The package includes the Probe runtime. Linux uses the machine's normal access rules for USB serial ports.

Both apps use **Start support**, **Copy code** and **End access**. Preview builds with checksums are attached to the [desktop packages workflow](https://github.com/zkwasm/diagnose/actions/workflows/desktop-packages.yml) after successful builds.

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

Each command should print a version number. The Node.js number begins with `v` and must be **20.10.0 or later**. npm and npx have their own version numbers. If all three checks succeed, continue to [Start the probe](#start-the-probe).

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

## Start the probe

Connect the equipment as agreed with your diagnostician. For USB or serial, use a data cable or adapter and install any required driver. For a network device, use a computer that can reach the device on the local network.

```sh
npx @masstensor/diagnose@latest start
```

In Windows PowerShell, use `npx.cmd`. On the first run, type `y` if npm asks to download Diagnose.

Or install once:

```sh
npm install -g @masstensor/diagnose@latest
diagnose start
```

The probe asks which approval mode to use before displaying the first invitation. Starting with v0.8.5, the choices are:

| Startup choice | What it allows |
| --- | --- |
| Enter · Approve everything | Let the person with this one-time invitation connect, run tasks and receive results automatically. |
| `r` · Review | Confirm the connection and review each task and result transfer. |
| `a` · Auto tasks only | Confirm the connection once. Tasks and result transfers then proceed automatically. |

Share an **Approve everything** invitation only with the intended diagnostician. Type `permissions ask` to cancel that choice before pairing or revoke auto approval after pairing. The next invitation does not inherit it. Requests to remember a diagnostician still require confirmation.

The terminal shows a **nine-letter invitation**, such as `abc-def-ghi`. Keep it open. Share the code privately by message or read it aloud. With a 0.8.4+ probe and relay, it lasts **two hours** and is consumed by successful pairing. Case, spaces and hyphens do not matter when entering it. Treat the code as a secret and keep it out of shell arguments. After expiry or five attempted handshakes, the running probe generates a new code.

On 0.8.5+, the probe uses the computer's display language when supported. Run `diagnose start --lang es`, `--lang zh`, or `--lang en` to choose Spanish, Simplified Chinese, or English. Leave the probe open if Wi-Fi drops. The diagnostician can reconnect to the same temporary session when both use 0.8.5 or later.

The probe will show the connecting party's self-reported label and the session fingerprint. Check these with the intended diagnostician before accepting. A code proves possession of the secret, not a person's identity.

## Choose and change permissions

The connection prompt depends on the startup choice. With per-task review selected:

| Choice | Effect |
| --- | --- |
| `y` | Approve the session, then review each operation or batch and its result transmission. |
| `a` | Authorize automatic execution **and automatic transmission** for this temporary session. Subsequent tasks do not prompt again. |
| `N` or Enter | Refuse the connection. |

If you chose **Auto tasks only** at startup, press `y` at the connection prompt to confirm automatic mode, or `r` to connect and review each task and its results.

In manual mode, a batch has one execution approval and one combined result approval, rather than one prompt per step. Complete scripts are approved as a whole, not line by line.

At either review prompt, press `y` to approve once, `a` to automatically approve execution and result transmission for the rest of this session, or `d` to see the full details. Press Enter to decline. Run `permissions ask` to switch back to review.

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

Only the user can enable automatic mode. For each new invitation, choose per-task review, `a` for automatic tasks and results with a pairing prompt, or `e` to preapprove the connection too. Already transmitted data cannot be recalled. Completed changes are not automatically rolled back.

Do not ask the AI to collect OS passwords. For interactive authentication, the user can use local hidden input with a trusted foreground program; Diagnose does not automatically elevate privileges. Hidden input has not been validated on Windows. On macOS/Linux, ordinary descendants in a managed process group are terminated when its leader exits or the resource is closed. This is not OS sandbox containment: a deliberately detached daemon can escape that group; Windows process-tree termination still requires real-device validation.

After the session, use [local history](troubleshooting.md#review-local-history-and-clean-up) to check what was collected and sent.
