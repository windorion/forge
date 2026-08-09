#!/usr/bin/env bash
set -euo pipefail

# Drive an allowlisted DEBUG-only action after Mission Control task detail is
# visible. Usage: script/drive_mission_control_action.sh <show-commands|show-git>

ACTION="${1:?usage: script/drive_mission_control_action.sh <show-commands|show-git>}"

case "$ACTION" in
  show-commands|show-git) ;;
  *)
    echo "error: unsupported Mission Control debug action: $ACTION" >&2
    exit 2
    ;;
esac

if ! pgrep -x ForgeApp >/dev/null; then
  echo "error: ForgeApp is not running" >&2
  exit 1
fi

defaults write com.windorion.forge forge.debug.missionControlAction -string "$ACTION"
notifyutil -p com.windorion.forge.debug.mission-control-action
sleep 0.6
