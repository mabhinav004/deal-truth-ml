#!/usr/bin/env bash
# Production start: compile if needed, then Node (not wrangler).
# Never prints secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

DEFAULT_PORT=8081
BUNDLE_ENTRY="dist/main.js"

is_valid_port() {
  local port="$1"
  [[ "${port}" =~ ^[0-9]+$ ]] && [ "${port}" -ge 1 ] && [ "${port}" -le 65535 ]
}

PORT="${PORT:-${DEFAULT_PORT}}"
if ! is_valid_port "${PORT}"; then
  echo "Invalid PORT: must be an integer 1-65535." >&2
  exit 1
fi
export PORT

if [ ! -f "${BUNDLE_ENTRY}" ]; then
  npm run build
fi
if [ ! -f "${BUNDLE_ENTRY}" ]; then
  echo "Build failed: ${BUNDLE_ENTRY} was not created." >&2
  exit 1
fi

exec node "${BUNDLE_ENTRY}"
