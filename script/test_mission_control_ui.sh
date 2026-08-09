#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
repository_root="${script_directory:h}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_directory="${FORGE_XCUI_ARTIFACT_DIR:-${repository_root}/build/mission-control-xcui/${timestamp}}"
derived_data="${FORGE_XCUI_DERIVED_DATA:-/tmp/forge-mission-control-xcui-derived}"

mkdir -p "${artifact_directory}" "${derived_data}"
cd "${repository_root}"
ruby script/generate_xcode_ui_test_project.rb

action="test"
result_arguments=(
  -resultBundlePath "${artifact_directory}/ForgeAppUI.xcresult"
  -only-testing:ForgeAppUITests/MissionControlUITests
)
build_settings=(COMPILER_INDEX_STORE_ENABLE=NO)
if [[ "${FORGE_XCUI_BUILD_ONLY:-0}" == "1" ]]; then
  action="build-for-testing"
  result_arguments=()
  build_settings+=(CODE_SIGNING_ALLOWED=NO)
fi

set +e
xcodebuild \
  -project ForgeApp.xcodeproj \
  -scheme ForgeAppUI \
  -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "${derived_data}" \
  "${action}" \
  "${result_arguments[@]}" \
  "${build_settings[@]}" 2>&1 | tee "${artifact_directory}/xcodebuild.log"
exit_code=${pipestatus[1]}
set -e

if (( exit_code != 0 )); then
  print -u2 "Mission Control XCUITest failed. See ${artifact_directory}/xcodebuild.log"
  print -u2 "On first use, macOS may require local authentication to authorize XCTest UI control. Approve that system prompt and rerun."
  exit "${exit_code}"
fi

print "Mission Control XCUITest evidence: ${artifact_directory}"
