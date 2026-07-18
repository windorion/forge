#!/usr/bin/env bash
set -euo pipefail

# Drive the DEBUG build onto a workspace surface for verification captures.
# Usage: script/drive_surface.sh <spec>
# Specs: missionControl | history | answerQueue | taskQueue | palette |
#        dismiss | diff:<taskID> | audit:<taskID> | fullPlan:<taskID>:<revID>

SPEC="${1:?usage: script/drive_surface.sh <surface-spec>}"

if ! pgrep -x ForgeApp >/dev/null; then
  echo "error: ForgeApp is not running" >&2
  exit 1
fi

defaults write com.windorion.forge forge.debug.presentSurface -string "$SPEC"
notifyutil -p com.windorion.forge.debug.present
sleep 0.6
