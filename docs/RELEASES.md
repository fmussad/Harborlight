# Releases

Release history and upgrade notes. The process itself is documented in
[PUBLISHING.md](PUBLISHING.md).

Versions follow [semantic versioning](https://semver.org). Artifacts for every release are a `.deb`
and an AppImage for amd64 and arm64, plus `install.sh`, `checksums.sha256` and `release.json`.

## Unreleased

Nothing yet.

## 0.1.0 — initial release

The first complete version: a working desktop client for Docker on Ubuntu, not a preview.

### Added

**Application shell**

- Sidebar navigation (Overview, Containers, Compose, Images, Volumes, Networks, Registry, Settings),
  top bar with global search, notification centre and quick terminal access.
- Light, dark and system themes with the preference persisted in the main process.
- Command palette on `Ctrl+K` for navigation and container actions.
- System tray with engine status, quick navigation, start-at-login and launch-minimised toggles;
  close-to-tray and single-instance behaviour.

**Docker**

- Typed `ContainerEngine` abstraction with a real Docker Engine adapter (Dockerode over a Unix
  socket) and a complete in-memory mock adapter.
- Socket discovery for rootful, rootless and `DOCKER_HOST` sockets, with a friendly explanation when
  permissions are the problem.
- Overview with running/stopped counts, CPU, memory and disk usage, 24-hour history and recent
  container activity.
- Containers: list and card views, grouping by Compose stack, filters, search, bulk actions, and
  start, stop, restart, pause, unpause, kill, rename, remove and run.
- Live logs with follow, tail size, level filter, plain or regex search with highlighting, pause,
  clear and export.
- Interactive container terminal over the Docker exec API with TTY resize and shell fallback.
- Images: disk usage breakdown, pull with progress and cancellation, tag, inspect, history, remove,
  and optional Trivy vulnerability scanning.
- Cleanup planner with per-category selection, a dry run, and volumes as a separate opt-in category.
- Volumes and networks: listing, in-use detection, inspection and guarded removal.
- Compose Studio: project discovery, YAML editor with linting, service topology graph, command
  preview, and up/down/start/stop/restart/pull/build with streamed output.
- Registry management with credentials stored through the OS keyring.

**Platform**

- `.deb` and AppImage for amd64 and arm64, built with electron-builder.
- `install.sh` with install, upgrade, uninstall, purge, doctor, version and help, plus dry-run,
  autostart, desktop entry and Docker/Compose handling.
- `Makefile` covering bootstrap, dev, stop, logs, doctor, lint, typecheck, test, e2e, build,
  package, icons, install, uninstall, publish and clean.
- Release pipeline producing checksums and a versioned manifest, with local and GitHub providers.

### Security

- Sandboxed, context-isolated renderer with no Node.js integration and a strict CSP without
  `unsafe-eval`.
- Explicit IPC command allowlist with Zod validation on every payload and a trusted-sender check.
- External commands spawned as argument arrays with `shell: false`.
- Registry credentials encrypted with Electron `safeStorage`; no plaintext on disk.
- Confirmation, with typed confirmation for data loss, on every destructive operation.
- Refuses to run as root; never modifies Docker socket permissions.

### Known limitations

- Remote Docker endpoints (`tcp://`, `ssh://`) are rejected; only local Unix sockets are supported.
- Kubernetes, Swarm and Docker contexts are out of scope.
- Image building outside Compose is not implemented.
- Vulnerability scanning requires Trivy to be installed separately.
- Auto-update is intentionally report-only: Harborlight tells you a new version exists and prints
  the upgrade command, but never downloads or installs it.

## Upgrade notes

### Any version → 0.1.0

Nothing to do; this is the first release.

### General upgrade guidance

- `~/.config/Harborlight/` is never touched by an upgrade. Settings, registries and stored
  credentials survive.
- The settings file is validated on load, and unknown or missing fields fall back to defaults, so
  downgrading is safe as well.
- Upgrade with `git pull --ff-only && make install` from a checkout, or
  `./install.sh upgrade --source release --channel stable` from a release.
