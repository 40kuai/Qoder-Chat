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

if [[ -z "${QODER_PAT:-}" ]]; then
  QODER_PAT="${QODERCN_PERSONAL_ACCESS_TOKEN:-${QODER_PERSONAL_ACCESS_TOKEN:-}}"
  export QODER_PAT
fi
: "${QODER_PAT:?QODER_PAT is required. Put it in .env or export QODERCN_PERSONAL_ACCESS_TOKEN.}"

if [[ "$QODER_PAT" != pt-* ]]; then
  echo "Warning: QODER_PAT does not start with 'pt-'; QoderCN PATs normally do." >&2
fi

if [[ -z "${PROXY_API_KEY:-}" ]]; then
  PROXY_API_KEY="sk-qoder-$(openssl rand -hex 24)"
  export PROXY_API_KEY
  touch .env
  printf '\nPROXY_API_KEY=%s\n' "$PROXY_API_KEY" >> .env
  chmod 600 .env 2>/dev/null || true
  echo "Generated PROXY_API_KEY and saved it to .env"
fi

APP="${QODER_APP_PATH:-/Applications/Qoder CN.app}"
ELECTRON="${APP}/Contents/MacOS/Qoder CN"
if [[ ! -x "$ELECTRON" ]]; then
  echo "Qoder CN not found at: $ELECTRON" >&2
  exit 1
fi

exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$(pwd)/server.mjs"
