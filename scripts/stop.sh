#!/usr/bin/env bash
#
# Stops the development session started by scripts/dev.sh.
#
# Only the recorded process group is signalled, so unrelated Node, Electron or
# Docker processes are never touched. Running this twice is harmless.
#
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT}/.harborlight"
PID_FILE="${RUN_DIR}/dev.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  printf 'No development session is recorded. Nothing to stop.\n'
  exit 0
fi

pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
rm -f "${PID_FILE}"

if [[ -z "${pid}" ]]; then
  printf 'The PID file was empty; removed it.\n'
  exit 0
fi

if ! kill -0 "${pid}" 2>/dev/null; then
  printf 'Process %s is already gone; removed the stale PID file.\n' "${pid}"
  exit 0
fi

# dev.sh starts the session with setsid, so the pid is also the group id.
target="-${pid}"
kill -0 "${pid}" 2>/dev/null || exit 0

printf 'Stopping development session (pid %s)…\n' "${pid}"
kill -TERM "${target}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true

for _ in $(seq 1 20); do
  kill -0 "${pid}" 2>/dev/null || { printf 'Stopped.\n'; exit 0; }
  sleep 0.25
done

printf 'It did not exit in time; sending SIGKILL.\n' >&2
kill -KILL "${target}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
printf 'Stopped.\n'
