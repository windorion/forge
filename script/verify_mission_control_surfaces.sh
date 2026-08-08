#!/usr/bin/env bash
set -euo pipefail

# Drive a running DEBUG ForgeApp through the four safety-significant Mission
# Control states and capture the native window after each transition.
CAPTURE_ROOT="$HOME/Library/Caches/Forge/debug-captures"
mkdir -p "$CAPTURE_ROOT"
BEFORE_COUNT="$(find "$CAPTURE_ROOT" -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"

for state in observer active queued review; do
  "$(dirname "$0")/drive_surface.sh" "missionControlFixture:$state"
  "$(dirname "$0")/capture_screen.sh" mission-control-fairness
done

AFTER_COUNT="$(find "$CAPTURE_ROOT" -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"
NEW_COUNT="$((AFTER_COUNT - BEFORE_COUNT))"
if (( NEW_COUNT < 4 )); then
  echo "error: expected at least 4 new Mission Control captures, found $NEW_COUNT" >&2
  exit 1
fi

echo "Mission Control native surface automation passed: $NEW_COUNT capture(s)."
echo "States: observer -> active -> queued -> review"
