# Diagnose Probe desktop packages

The desktop apps use the same on-site Probe runtime as the CLI. They bundle Node.js and native serial modules. Users choose a language, start support, share a one-time code and end access from the window.

Download installers and SHA-256 checksums from the [0.8.5 desktop preview release](https://github.com/zkwasm/diagnose/releases/tag/v0.8.5-desktop.1).

| Platform | Preview builds | Build command |
| --- | --- | --- |
| Windows x64 | [Tests workflow](https://github.com/zkwasm/diagnose/actions/workflows/test.yml) | [Windows build instructions](windows/README.md) |
| macOS 13+, Apple Silicon and Intel | [Desktop packages workflow](https://github.com/zkwasm/diagnose/actions/workflows/desktop-packages.yml) | `sh desktop/macos/build.sh` |
| Ubuntu 22.04+ or Debian 12+, amd64 and arm64 | [Desktop packages workflow](https://github.com/zkwasm/diagnose/actions/workflows/desktop-packages.yml) | `sh desktop/linux/build.sh` |

## Build locally

Use an official Node.js 22 distribution for the target architecture. Run `npm ci` from the repository root before the build command. If the Node.js license is outside its distribution folder, set `DIAGNOSE_NODE_LICENSE` to that distribution's license file. An optional argument specifies the output directory.

- macOS needs the Swift compiler and disk-image tools. Set `MACOS_SIGN_IDENTITY` to your Developer ID Application identity and `MACOS_NOTARY_PROFILE` to a configured keychain profile to sign, notarize and staple the DMG. CI produces a development preview.
- Linux needs a C compiler, pkg-config, `dpkg-deb`, `libgtk-3-dev` and `libjson-glib-dev`. To target Ubuntu 22.04 and Debian 12, build on Ubuntu 22.04. The generated package declares its desktop library dependencies.

Each build writes a SHA-256 checksum. Before distribution, test on a clean machine without separately installed Node.js. Open the app from the OS menu, create a temporary invitation, pair, test read-only capture from the intended USB device as a standard user, and close the window. Check that the session ends. Linux serial devices may require the machine's normal device-access permissions.
