#!/bin/sh
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$(dirname "$here")")
output=${1:-"$root/linux-installer"}
mkdir -p "$output"
output=$(CDPATH='' cd -- "$output" && pwd)
version=$(node -p "require(process.argv[1]).version" "$root/package.json")
arch=$(dpkg --print-architecture)
case "$(node -p 'process.arch'):$arch" in
    x64:amd64|arm64:arm64) ;;
    *) echo 'Build on Debian or Ubuntu using a Node binary for the build architecture.' >&2; exit 1 ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
package="$work/package"
app="$package/opt/diagnose-probe"
mkdir -p "$app" "$package/DEBIAN" "$package/usr/share/applications" "$package/usr/share/icons/hicolor/512x512/apps"
node "$root/desktop/stage.mjs" "$app/runtime"
cc -std=c11 -O2 -Wall -Wextra -Wno-unused-parameter "$here/probe.c" -o "$app/diagnose-probe" $(pkg-config --cflags --libs gtk+-3.0 json-glib-1.0)
"$app/diagnose-probe" --check-runtime
cat > "$package/DEBIAN/control" <<CONTROL
Package: diagnose-probe
Version: $version
Section: utils
Priority: optional
Architecture: $arch
Maintainer: Diagnose contributors
Depends: libc6 (>= 2.34), libstdc++6, libgtk-3-0t64 | libgtk-3-0, libjson-glib-1.0-0
Homepage: https://diagnose.fenginwind.com
Description: On-site desktop probe for remote device diagnostics
 Share a temporary pairing code and control access from the desktop.
CONTROL
cat > "$package/usr/share/applications/com.fenginwind.diagnose.probe.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Diagnose Probe
Comment=Receive remote help with connected equipment
Exec=/opt/diagnose-probe/diagnose-probe
Icon=diagnose-probe
Terminal=false
Categories=Utility;
DESKTOP
cp "$root/desktop/icons/diagnose-probe.png" "$package/usr/share/icons/hicolor/512x512/apps/diagnose-probe.png"
name="diagnose-probe-${version}_${arch}.deb"
dpkg-deb --root-owner-group --build "$package" "$output/$name"
(cd "$output" && sha256sum "$name" > "$name.sha256")
