#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"
duration_seconds="${1:-21600}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_directory="${2:-${repository_root}/build/mission-control-soak/${timestamp}}"
power_conditions="${3:-${FORGE_SOAK_POWER_NOTES:-Not recorded; operator should note AC/battery and sleep settings}}"

if [[ ! "${duration_seconds}" =~ '^[0-9]+$' ]] || (( duration_seconds > 86400 )); then
  print -u2 "duration must be an integer from 0 through 86400 seconds"
  exit 64
fi

mkdir -p "${report_directory}"
cd "${repository_root}/runtime"
npm run build

FORGE_FAIR_QUEUE_SOAK_SECONDS="${duration_seconds}" \
FORGE_FAIR_QUEUE_REPORT_DIR="${report_directory}" \
FORGE_SOAK_POWER_NOTES="${power_conditions}" \
node scripts/mission-control-fairness-fixtures.mjs

print "Mission Control soak evidence: ${report_directory}"
