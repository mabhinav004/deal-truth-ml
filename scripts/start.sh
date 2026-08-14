#!/usr/bin/env bash
# Production/Render start: bundle once, then wrangler --no-bundle.
# wrangler dev's esbuild watcher deadlocks on small VMs (Render).
# Never prints secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

DEFAULT_PORT=8081
BUNDLE_DIR="dist"
BUNDLE_ENTRY="${BUNDLE_DIR}/index.js"

is_valid_port() {
  local port="$1"
  [[ "${port}" =~ ^[0-9]+$ ]] && [ "${port}" -ge 1 ] && [ "${port}" -le 65535 ]
}

write_dev_vars() {
  if [ -z "${INTERNAL_API_TOKEN:-}" ]; then
    return 0
  fi
  if [[ "${INTERNAL_API_TOKEN}" == *$'\n'* || "${INTERNAL_API_TOKEN}" == *$'\r'* ]]; then
    echo "INTERNAL_API_TOKEN must be a single line." >&2
    exit 1
  fi
  printf 'INTERNAL_API_TOKEN=%s\n' "${INTERNAL_API_TOKEN}" > .dev.vars
}

ensure_bundle() {
  if [ -f "${BUNDLE_ENTRY}" ]; then
    return 0
  fi
  npx wrangler deploy --dry-run --outdir "${BUNDLE_DIR}"
  if [ ! -f "${BUNDLE_ENTRY}" ]; then
    echo "Bundle failed: ${BUNDLE_ENTRY} was not created." >&2
    exit 1
  fi
}

PORT="${PORT:-${DEFAULT_PORT}}"
if ! is_valid_port "${PORT}"; then
  echo "Invalid PORT: must be an integer 1-65535." >&2
  exit 1
fi

write_dev_vars
ensure_bundle

# --no-bundle skips esbuild Watch (the Render deadlock).
# --show-interactive-dev-session false avoids TTY/devtools RPC on a VM.
exec npx wrangler dev "${BUNDLE_ENTRY}" \
  --no-bundle \
  --ip 0.0.0.0 \
  --port "${PORT}" \
  --live-reload false \
  --show-interactive-dev-session false
