#!/bin/sh
# Build the pet app. Needs Xcode Command Line Tools for swiftc; nothing else.
#
#   ./build.sh [output-dir]      default: ./build
#
# The app reads its art relative to its own location (or from PORCUPINE_PET_HOME), so the
# resources folder has to sit beside the .app, which is what this script arranges.
set -e
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/build}
app="$out/Pet.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

# A module cache inside the package: two Swift toolchains on a machine leave a stale cache
# that fails with "SDK is not supported by the compiler", and a private cache avoids it.
TMPDIR="${TMPDIR:-/tmp}" swiftc -O \
  -module-cache-path "$out/.swift-module-cache" \
  -o "$app/Contents/MacOS/Pet" \
  "$here/src/main.swift" "$here/src/thinkbox.swift"
cp "$here/src/pet-status.py" "$out/"
cp -R "$here/resources" "$out/" 2>/dev/null || true
if [ -f "$here/resources/pet/hedgehog/sprite.png" ]; then :; fi

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Porcupine Pet</string>
  <key>CFBundleIdentifier</key><string>glass.porcupine.pet</string>
  <key>CFBundleExecutable</key><string>Pet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PLIST
echo "built $app"
echo "run it with: open -g \"$app\""
