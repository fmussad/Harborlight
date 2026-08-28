#!/usr/bin/env bash
#
# Starts the Harborlight development session (Vite + Electron).
#
# The process group id is recorded in .harborlight/dev.pid so `make stop` can
# terminate exactly what this script started. No broad `pkill electron`.
#
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT}/.harborlight"
PID_FILE="${RUN_DIR}/dev.pid"
LOG_FILE="${RUN_DIR}/dev.log"

MOCK="${MOCK:-0}"
FOREGROUND="${FOREGROUND:-0}"

mkdir -p "${RUN_DIR}"

running_pid() {
  [[ -f "${PID_FILE}" ]] || return 1
  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  # Only treat it as ours if the process still exists and looks like our session.
  if kill -0 "${pid}" 2>/dev/null; then
    printf '%s' "${pid}"
    return 0
  fi
  return 1
}

if pid="$(running_pid)"; then
  printf 'Harborlight dev is already running (pid %s).\n' "${pid}"
  printf 'Logs:  make logs\n'
  printf 'Stop:  make stop\n'
  exit 0
fi

# A stale PID file means the previous session died; clean it up quietly.
rm -f "${PID_FILE}"

if [[ ! -d "${ROOT}/node_modules" ]]; then
  printf 'Dependencies are missing. Run: make bootstrap\n' >&2
  exit 1
fi

export HARBORLIGHT_LOG_LEVEL="${HARBORLIGHT_LOG_LEVEL:-debug}"
[[ "${MOCK}" == "1" ]] && export HARBORLIGHT_ENGINE=mock

# Editors that are themselves Electron apps export this; it would turn the
# Electron binary into a plain Node process.
unset ELECTRON_RUN_AS_NODE

printf '%s\n' "Starting Harborlight dev${MOCK:+ (mock engine: ${MOCK})}"

if [[ "${FOREGROUND}" == "1" ]]; then
  exec npx electron-vite dev
fi

: >"${LOG_FILE}"
# setsid gives the session its own process group, so stopping it cannot reach
# unrelated Node or Electron processes.
setsid npx electron-vite dev >>"${LOG_FILE}" 2>&1 &
pid=$!
printf '%s' "${pid}" >"${PID_FILE}"

# Give it a moment so an immediate crash is reported here instead of silently.
sleep 2
if ! kill -0 "${pid}" 2>/dev/null; then
  rm -f "${PID_FILE}"
  printf 'The dev session exited immediately. Last lines:\n\n' >&2
  tail -n 20 "${LOG_FILE}" >&2 || true
  exit 1
fi

printf 'Started (pid %s).\n' "${pid}"
printf 'Logs:  make logs   (%s)\n' "${LOG_FILE#"${ROOT}/"}"
printf 'Stop:  make stop\n'
