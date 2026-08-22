#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="ForgeApp"
BUNDLE_NAME="Forge"
BUNDLE_ID="com.windorion.forge"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$BUNDLE_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
RUNTIME_RESOURCE="$APP_RESOURCES/runtime"
FORGE_SWIFT_MODULE_CACHE="${SWIFTPM_MODULECACHE_OVERRIDE:-$ROOT_DIR/.build/module-cache}"
FORGE_CLANG_MODULE_CACHE="${CLANG_MODULE_CACHE_PATH:-$ROOT_DIR/.build/clang-module-cache}"

case "$MODE" in
  build|--build-only|run|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    echo "usage: $0 [build|--build-only|run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac

mkdir -p "$FORGE_SWIFT_MODULE_CACHE" "$FORGE_CLANG_MODULE_CACHE"
export SWIFTPM_MODULECACHE_OVERRIDE="$FORGE_SWIFT_MODULE_CACHE"
export CLANG_MODULE_CACHE_PATH="$FORGE_CLANG_MODULE_CACHE"

cd "$ROOT_DIR"
swift build
BUILD_BINARY="$(swift build --show-bin-path)/$APP_NAME"
rm -rf "$ROOT_DIR/runtime/dist"
(cd "$ROOT_DIR/runtime" && npm run build)

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS"
mkdir -p "$RUNTIME_RESOURCE"
mkdir -p "$APP_RESOURCES/Fonts"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
# SwiftPM applies a compiler ad-hoc signature (including get-task-allow) to
# debug executables. Assembly is intentionally unsigned; signing profiles are
# applied and verified as a separate, explicit distribution step.
if /usr/bin/codesign -d "$APP_BINARY" >/dev/null 2>&1; then
  /usr/bin/codesign --remove-signature "$APP_BINARY"
fi
if /usr/bin/codesign -d "$APP_BINARY" >/dev/null 2>&1; then
  echo "failed to produce an unsigned application executable" >&2
  exit 1
fi
cp "$ROOT_DIR/runtime/package.json" "$RUNTIME_RESOURCE/package.json"
cp -R "$ROOT_DIR/runtime/dist" "$RUNTIME_RESOURCE/dist"
cp "$ROOT_DIR/design_handoff_forge/assets/forge-logo.png" "$APP_RESOURCES/forge-logo.png"
cp "$ROOT_DIR/apps/macos/Resources/appcast.xml" "$APP_RESOURCES/appcast.xml"
cp "$ROOT_DIR/apps/macos/Resources/Fonts/JetBrainsMono-Regular.ttf" "$APP_RESOURCES/Fonts/JetBrainsMono-Regular.ttf"
cp "$ROOT_DIR/apps/macos/Resources/Fonts/JetBrainsMono-Bold.ttf" "$APP_RESOURCES/Fonts/JetBrainsMono-Bold.ttf"
cp "$ROOT_DIR/apps/macos/Resources/Fonts/OFL.txt" "$APP_RESOURCES/Fonts/OFL.txt"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$BUNDLE_NAME</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>com.windorion.forge.deeplink</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>forge</string>
      </array>
    </dict>
  </array>
  <key>CFBundleShortVersionString</key>
  <string>0.4.2</string>
  <key>CFBundleVersion</key>
  <string>42</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

# Signing must see a deterministic bundle without Finder/resource-fork or
# provenance metadata inherited from source assets.
/usr/bin/xattr -cr "$APP_BUNDLE"

if [[ "$MODE" == "build" || "$MODE" == "--build-only" ]]; then
  echo "$APP_BUNDLE"
  exit 0
fi

stop_running_app() {
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
}

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    stop_running_app
    open_app
    ;;
  --debug|debug)
    stop_running_app
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    stop_running_app
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    stop_running_app
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    stop_running_app
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
esac
