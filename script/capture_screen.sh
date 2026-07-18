#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ForgeApp"
SCREEN_ID="${1:?usage: script/capture_screen.sh <screen-id>}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_DIR="$ROOT_DIR/docs/verification/$SCREEN_ID"
CAPTURE_CACHE="$HOME/Library/Caches/Forge/debug-captures"
mkdir -p "$EVIDENCE_DIR" "$CAPTURE_CACHE"

if ! pgrep -x "$APP_NAME" >/dev/null; then
  echo "error: $APP_NAME is not running. Launch it first with script/build_and_run.sh run" >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)"

# Primary path: ask the debug build to render its own windows (no Screen
# Recording permission needed). See DebugWindowCapture.swift.
MARKER="$CAPTURE_CACHE/.marker"
touch "$MARKER"
sleep 0.3
notifyutil -p com.windorion.forge.debug.capture

FOUND=0
for _ in $(seq 1 20); do
  sleep 0.25
  while IFS= read -r file; do
    base="$(basename "$file")"
    cp "$file" "$EVIDENCE_DIR/${TIMESTAMP}_${SHA}_${base#*_}"
    FOUND=1
  done < <(find "$CAPTURE_CACHE" -name '*.png' -newer "$MARKER" 2>/dev/null)
  [ "$FOUND" = 1 ] && break
done
rm -f "$MARKER"

if [ "$FOUND" = 1 ]; then
  echo "saved self-rendered capture(s):"
  ls "$EVIDENCE_DIR/${TIMESTAMP}_${SHA}"_*.png
else
  echo "warn: no self-rendered capture appeared (is this a DEBUG build?)" >&2
fi

# Bonus path: true-pixel region capture, only works if the calling process
# has Screen Recording permission. Non-fatal when unavailable.
if POS="$(osascript -e "tell application \"System Events\" to tell (first process whose name is \"$APP_NAME\") to get position of first window" 2>/dev/null)" \
   && SIZE="$(osascript -e "tell application \"System Events\" to tell (first process whose name is \"$APP_NAME\") to get size of first window" 2>/dev/null)"; then
  X="${POS%%, *}"; Y="${POS#*, }"; W="${SIZE%%, *}"; H="${SIZE#*, }"
  OUT="$EVIDENCE_DIR/${TIMESTAMP}_${SHA}_screen.png"
  if screencapture -x -R"${X},${Y},${W},${H}" "$OUT" 2>/dev/null; then
    echo "saved true-pixel capture: $OUT"
  fi
fi

if [ "$FOUND" != 1 ]; then
  exit 1
fi
