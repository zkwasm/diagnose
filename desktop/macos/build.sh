#!/bin/sh
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$(dirname "$here")")
output=${1:-"$root/macos-installer"}
mkdir -p "$output"
output=$(CDPATH='' cd -- "$output" && pwd)
version=$(node -p "require(process.argv[1]).version" "$root/package.json")
arch=$(node -p 'process.arch')
case "$arch" in arm64) swift_arch=arm64;; x64) swift_arch=x86_64;; *) echo "Unsupported macOS architecture: $arch" >&2; exit 1;; esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
app="$work/image/Diagnose Probe.app"
runtime="$app/Contents/Resources/runtime"
mkdir -p "$app/Contents/MacOS"
node "$root/desktop/stage.mjs" "$runtime"
if [ "$(lipo -archs "$runtime/node")" != "$swift_arch" ]; then
    lipo -thin "$swift_arch" "$runtime/node" -output "$work/node"
    mv "$work/node" "$runtime/node"
    chmod 755 "$runtime/node"
fi
# Keep external symbols used by native Node add-ons, and discard debug/local symbols.
xcrun strip -S -x "$runtime/node"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.fenginwind.diagnose.probe</string>
<key>CFBundleExecutable</key><string>Diagnose Probe</string>
<key>CFBundleName</key><string>Diagnose Probe</string>
<key>CFBundleDisplayName</key><string>Diagnose Probe</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleVersion</key><string>$version</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
swiftc -target "$swift_arch-apple-macosx13.0" -module-cache-path "$work/swift-cache" -O "$here/Probe.swift" -o "$app/Contents/MacOS/Diagnose Probe"
if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
    find "$runtime/node_modules" -type f \( -name '*.node' -o -name '*.dylib' -o -name spawn-helper \) -exec codesign --force --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" {} \;
    codesign --force --options runtime --timestamp --entitlements "$here/node-entitlements.plist" --sign "$MACOS_SIGN_IDENTITY" "$runtime/node"
    codesign --force --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$app"
else
    codesign --force --sign - "$runtime/node"
    codesign --force --sign - "$app"
fi
codesign --verify --deep --strict "$app"
"$app/Contents/MacOS/Diagnose Probe" --check-runtime
ln -s /Applications "$work/image/Applications"
name="Diagnose-Probe-$version-macOS-$arch.dmg"
hdiutil create -fs HFS+ -format ULMO -volname "Diagnose Probe" -srcfolder "$work/image" -ov "$output/$name"
if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
    codesign --force --timestamp --sign "$MACOS_SIGN_IDENTITY" "$output/$name"
fi
if [ -n "${MACOS_NOTARY_PROFILE:-}" ]; then
    [ -n "${MACOS_SIGN_IDENTITY:-}" ] || { echo 'Notarization requires a Developer ID signing identity.' >&2; exit 1; }
    xcrun notarytool submit "$output/$name" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait
    xcrun stapler staple "$output/$name"
    xcrun stapler validate "$output/$name"
fi
(cd "$output" && shasum -a 256 "$name" > "$name.sha256")
