#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < .env
fi

APP="${QODER_APP_PATH:-/Applications/Qoder CN.app}"
ELECTRON="${APP}/Contents/MacOS/Qoder CN"
if [[ ! -x "$ELECTRON" ]]; then
  echo "Qoder CN not found at: $ELECTRON" >&2
  exit 1
fi

exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$(pwd)/accounts-cli.mjs" "$@"
