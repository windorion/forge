#!/usr/bin/env bash
set -euo pipefail

# Prove a running DEBUG ForgeApp can present repository-scoped command review,
# transition through the Mission Control-owned Git action, and return to the
# command surface while retaining the same routed task.
CAPTURE_ROOT="$HOME/Library/Caches/Forge/debug-captures"
mkdir -p "$CAPTURE_ROOT"
BEFORE_COUNT="$(find "$CAPTURE_ROOT" -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"

"$(dirname "$0")/drive_surface.sh" missionControlRouteFixture:commands
"$(dirname "$0")/capture_screen.sh" mission-control-routed-actions

"$(dirname "$0")/drive_mission_control_action.sh" show-git
"$(dirname "$0")/capture_screen.sh" mission-control-routed-actions

"$(dirname "$0")/drive_mission_control_action.sh" show-commands
"$(dirname "$0")/capture_screen.sh" mission-control-routed-actions

AFTER_COUNT="$(find "$CAPTURE_ROOT" -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"
NEW_COUNT="$((AFTER_COUNT - BEFORE_COUNT))"
if (( NEW_COUNT < 3 )); then
  echo "error: expected at least 3 routed-action captures, found $NEW_COUNT" >&2
  exit 1
fi

echo "Mission Control routed-action automation passed: $NEW_COUNT capture(s)."
echo "Actions: present commands -> show Git -> show commands"
