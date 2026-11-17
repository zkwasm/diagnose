#!/usr/bin/env bash
# Install a private Node.js 22 runtime without requiring Node, npm or sudo.
set -euo pipefail
umask 077
if command -v node >/dev/null 2>&1; then
  echo 'Existing Node.js detected. It will NOT be updated, replaced or reconfigured.'
  node --version
  if ! node -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=10)?0:1)' 2>/dev/null; then
    echo 'Diagnose requires Node.js 20.10+. Your installation was left unchanged. Ask your diagnostician about a separate compatible runtime.' >&2
    exit 1
  fi
  for tool in npm npx; do
    if ! command -v "$tool" >/dev/null 2>&1 || ! "$tool" --version; then echo "Existing Node.js is missing working $tool. Nothing was changed; ask your diagnostician for help." >&2; exit 1; fi
  done
  echo 'Setup complete. Existing Node.js, npm and npx were reused without changes.'
  exit 0
fi
prefix="$HOME/.diagnose/node"
mkdir -p "$prefix"
  case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo 'Use setup-node.ps1 on Windows.' >&2; exit 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Unsupported CPU. Ask your diagnostician for help.' >&2; exit 1 ;; esac
  for tool in curl tar awk; do command -v "$tool" >/dev/null || { echo "Missing $tool. Ask your diagnostician to install it." >&2; exit 1; }; done
  stage=$(mktemp -d "$prefix/.setup.XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  fetch() { curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --show-error --location --connect-timeout 20 --max-time 600 "$1" -o "$2"; }
  echo 'Finding the current Node.js 22 release on nodejs.org...'
  fetch https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt "$stage/checksums"
  filename=$(awk -v suffix="-$platform-$arch.tar.gz" '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $2;exit}' "$stage/checksums")
  [[ "$filename" =~ ^node-v22\.([0-9]+)\.[0-9]+-(darwin|linux)-(arm64|x64)\.tar\.gz$ ]] && [ "${BASH_REMATCH[1]}" -ge 18 ] || { echo 'Could not identify a supported official release.' >&2; exit 1; }
  expected=$(awk -v file="$filename" '$2==file {print $1;exit}' "$stage/checksums")
  echo "Downloading $filename from nodejs.org..."
  release=${filename#node-}; release=${release%%-*}
  fetch "https://nodejs.org/dist/$release/$filename" "$stage/node.tar.gz"
  if command -v shasum >/dev/null; then actual=$(shasum -a 256 "$stage/node.tar.gz" | awk '{print $1}'); else actual=$(sha256sum "$stage/node.tar.gz" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { echo 'Checksum mismatch. Nothing was installed. Run the setup command again.' >&2; exit 1; }
  echo 'Checksum verified. Installing into your private .diagnose/node directory...'
  tar -xzf "$stage/node.tar.gz" -C "$stage"
  directory=${filename%.tar.gz}
  "$stage/$directory/bin/node" --version
  if [ ! -e "$prefix/$directory" ]; then mv "$stage/$directory" "$prefix/$directory"; fi
  printf 'export PATH="$HOME/.diagnose/node/%s/bin:$PATH"\n' "$directory" > "$prefix/env"
  line='[ ! -f "$HOME/.diagnose/node/env" ] || . "$HOME/.diagnose/node/env"'
  if [ "$platform" = darwin ]; then profiles=("$HOME/.zshrc" "$HOME/.bash_profile"); else profiles=("$HOME/.bashrc" "$HOME/.profile"); fi
  for profile in "${profiles[@]}"; do
    if ! grep -Fqx "$line" "$profile" 2>/dev/null; then printf '\n# Diagnose private Node.js runtime\n%s\n' "$line" >> "$profile"; fi
  done
. "$prefix/env"
echo 'Checking Node.js, npm and npx:'
node --version
npm --version
npx --version
echo 'Setup complete. You can now run: npx @masstensor/diagnose@latest start'
