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

: "${PROXY_API_KEY:?PROXY_API_KEY is missing in .env}"

PORT="${PORT:-8788}"
MODEL="${DEFAULT_MODEL:-deepseek-flash}"
CONTEXT_WINDOW="${CONTEXT_WINDOW:-200000}"

BASE=""
if command -v curl >/dev/null 2>&1; then
  BASE="$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lan_base_url",""))' 2>/dev/null || true)"
fi
if [[ -z "$BASE" ]]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [[ -n "$IP" ]] || IP="127.0.0.1"
  BASE="http://${IP}:${PORT}"
fi
OPENAI="${BASE}/v1"

ACCOUNT_FILE="$HOME/.qoder-cn-pool/accounts.json"
DEFAULT_ACCOUNT=""
LOAD_BALANCE="on"
if [[ -f "$ACCOUNT_FILE" ]]; then
  DEFAULT_ACCOUNT="$(python3 - "$ACCOUNT_FILE" <<'PY' 2>/dev/null || true
import json,sys
d=json.load(open(sys.argv[1]))
a=next((x for x in d.get('accounts',[]) if x.get('id')==d.get('defaultAccountId')),None)
print(a['id'] if a else '')
PY
)"
  LOAD_BALANCE="$(python3 - "$ACCOUNT_FILE" <<'PY' 2>/dev/null || true
import json,sys
d=json.load(open(sys.argv[1]))
print('off' if d.get('loadBalance') is False else 'on')
PY
)"
fi

cat <<EOF
Qoder 模型代理接入信息
========================
Base URL (Claude) : ${BASE}
Base URL (OpenAI) : ${OPENAI}
API Key           : ${PROXY_API_KEY}
Model             : ${MODEL}
Context window    : ${CONTEXT_WINDOW}
Default account   : ${DEFAULT_ACCOUNT:-未设置}
Load balance      : ${LOAD_BALANCE}

--- Claude / Anthropic 环境变量 ---
export ANTHROPIC_BASE_URL="${BASE}"
export ANTHROPIC_AUTH_TOKEN="${PROXY_API_KEY}"
export ANTHROPIC_API_KEY="${PROXY_API_KEY}"
export ANTHROPIC_MODEL="${MODEL}"
export ANTHROPIC_SMALL_FAST_MODEL="${MODEL}"

--- OpenAI 兼容 Agent 环境变量 ---
export OPENAI_BASE_URL="${OPENAI}"
export OPENAI_API_BASE="${OPENAI}"
export OPENAI_API_KEY="${PROXY_API_KEY}"
export OPENAI_MODEL="${MODEL}"

--- 通用 JSON ---
{
  "provider": "openai",
  "baseUrl": "${OPENAI}",
  "apiKey": "${PROXY_API_KEY}",
  "model": "${MODEL}",
  "context_window": ${CONTEXT_WINDOW}
}

上下文窗口：请求体可传 "context_window": 200000 / 400000 / 1000000，以模型支持为准。
账号选择：不传 account 时按负载均衡设置（开启=自动选健康账号，关闭=默认账号）；传 "auto" 强制自动，传账号ID强制指定。也可用请求头 X-Qoder-Account。
提示：Claude Code 等依赖 tool_use 的客户端只能普通对话，本代理不执行工具。
EOF
