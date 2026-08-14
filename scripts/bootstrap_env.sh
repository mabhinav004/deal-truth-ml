#!/usr/bin/env bash
# Create local env files with empty placeholders. Never writes or prints secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ensure_key() {
  local file="$1"
  local key="$2"
  local default="${3:-}"
  if [ ! -f "${file}" ]; then
    return 0
  fi
  if grep -qE "^${key}=" "${file}"; then
    return 0
  fi
  printf '\n%s=%s\n' "${key}" "${default}" >> "${file}"
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env"
else
  echo ".env already exists"
fi

ensure_key .env CLOUDFLARE_API_TOKEN
ensure_key .env CLOUDFLARE_ACCOUNT_ID
ensure_key .env INTERNAL_API_TOKEN
ensure_key .env PORT 8081
ensure_key .env ENABLE_GENERATION true
ensure_key .env LOG_LEVEL info
