#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_APP="${1:-$ROOT_DIR/dist/Forge.app}"
DESTINATION_APP="${2:-}"

if [[ -z "$DESTINATION_APP" ]]; then
  echo "usage: $0 [SOURCE_APP] DESTINATION_APP" >&2
  echo "stage into a new path outside a file-provider/sync root before signing" >&2
  exit 2
fi
if [[ ! -d "$SOURCE_APP" || ! -f "$SOURCE_APP/Contents/Info.plist" ]]; then
  echo "source is not an assembled application bundle: $SOURCE_APP" >&2
  exit 2
fi
if [[ -e "$DESTINATION_APP" ]]; then
  echo "destination already exists; refusing to overwrite: $DESTINATION_APP" >&2
  exit 2
fi

mkdir -p "$(dirname "$DESTINATION_APP")"
/usr/bin/ditto --norsrc --noextattr "$SOURCE_APP" "$DESTINATION_APP"
/usr/bin/xattr -cr "$DESTINATION_APP"

if /usr/bin/xattr -lr "$DESTINATION_APP" 2>/dev/null | /usr/bin/grep -Eq 'com\.apple\.(FinderInfo|ResourceFork)'; then
  echo "staged bundle still contains signing-incompatible extended attributes: $DESTINATION_APP" >&2
  exit 1
fi

echo "$DESTINATION_APP"
