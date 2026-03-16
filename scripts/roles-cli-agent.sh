#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://localhost:1234/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-lmstudio}"
export OPENAI_MODEL="${OPENAI_MODEL:-qwen2.5-coder-7b-instruct-mlx}"
export ROLES_OUTPUT_LANGUAGE="${ROLES_OUTPUT_LANGUAGE:-en}"

cd "$ROOT_DIR"

if [ "$#" -eq 0 ]; then
  cat <<'EOF'
Usage:
  scripts/roles-cli-agent.sh start --topic "..."
  scripts/roles-cli-agent.sh reply --session <sessionId> --message "..."
  scripts/roles-cli-agent.sh start-discussion --session <sessionId>
  scripts/roles-cli-agent.sh report --session <sessionId>
  scripts/roles-cli-agent.sh list
  scripts/roles-cli-agent.sh show --session <sessionId>

Environment variables:
  OPENAI_BASE_URL
  OPENAI_API_KEY
  OPENAI_MODEL
  ROLES_OUTPUT_LANGUAGE
EOF
  exit 1
fi

exec bun run src/index.ts cli "$@"
