You are Claude Opus 5 operating as the primary implementation agent inside Cursor. Build the complete project described below. Do not stop after producing a plan: inspect the repository, create the architecture, implement the application, run it, test it, fix problems, package it, and leave clear documentation.

# Project

Create **Harborlight**, a modern Ubuntu-native alternative to Docker Desktop.

Tagline:

**Container workflows, reimagined for Ubuntu**

Harborlight is built with web technologies but distributed as an installable Electron desktop application. The renderer should remain web-first and portable, while all privileged Docker access must happen through Electron’s main process and a secure typed IPC boundary.

The attached PNG is the visual source of truth for Harborlight Light Mode. Reproduce its composition, visual language, navigation, spacing, color accents, window density, tables, charts, badges and general UX as closely as practical.

If a Dark Mode reference is also attached, use it as the source of truth for Dark Mode. Otherwise, derive Dark Mode from the same design tokens without changing the layout.

Do not create a generic admin dashboard. It must feel like a polished, purpose-built Ubuntu desktop container manager.

# Supported platforms

The application and installer must explicitly support:

- Ubuntu 22.04 LTS
- Ubuntu 24.04 LTS
- Ubuntu 26.04 LTS
- GNOME on X11 and Wayland
- x86_64
- arm64 when all packaging dependencies support it

Detect the actual operating system through `/etc/os-release`. Fail with a helpful message on unsupported distributions unless the user passes an explicit `--force-unsupported` option.

Do not run the desktop application as root.

# Technology stack

Use a current, production-ready stack:

- Electron
- TypeScript with strict mode enabled
- React
- Vite or electron-vite
- npm with a committed lockfile
- Tailwind CSS or a clean CSS-variable-based design system
- Radix UI or equivalent accessible primitives
- Lucide icons
- TanStack Query for asynchronous engine data
- Zustand or equivalent for local UI state
- Zod for schemas and IPC validation
- Dockerode or direct Docker Engine API access
- Xterm.js with fit and search addons
- CodeMirror 6 for Compose YAML
- React Flow for Compose topology
- Recharts or an equivalent lightweight chart library
- Vitest and React Testing Library
- Playwright Electron tests
- electron-builder for `.deb` and AppImage packaging

Use the current active Node.js LTS and pin it in `.nvmrc` and `package.json`.

Avoid unnecessary infrastructure. Do not introduce Kubernetes, a database server, microservices, GraphQL or a cloud backend.

# Architecture

Use a maintainable separation similar to:

```text
src/
  main/
    docker/
    compose/
    installer/
    ipc/
    services/
    tray/
    windows/
  preload/
  renderer/
    components/
    features/
    hooks/
    layouts/
    pages/
    providers/
    styles/
  shared/
    contracts/
    schemas/
    types/
resources/
  icons/
  desktop/
installer/
scripts/
tests/
docs/
```

Create a typed `ContainerEngine` abstraction so the UI does not directly depend on Dockerode.

Provide at least:

- `DockerEngineAdapter`: real local Docker Engine implementation.
- `MockEngineAdapter`: deterministic demo/testing implementation.
- A typed Electron IPC client exposed through preload.
- A future extension point for remote Docker contexts without implementing an insecure remote server.

The standard web renderer must not have Node.js access. It should be possible to run the renderer in browser development mode using mock data, but production Docker access must only work inside Electron.

# Electron security requirements

These requirements are mandatory:

- `contextIsolation: true`
- `nodeIntegration: false`
- Electron sandbox enabled where compatible
- Strict Content Security Policy
- No `eval`
- No renderer access to filesystem, `child_process`, Docker socket or environment secrets
- Expose a narrow typed API through preload
- Validate every IPC request with Zod
- Explicitly allowlist IPC commands
- Block unexpected navigation and new-window creation
- Allow external URLs only through an allowlist
- Never interpolate user input into shell commands
- Prefer the Docker Engine API over CLI commands
- When Docker Compose CLI is necessary, use `spawn` with an argument array and `shell: false`
- Validate Compose file paths and working directories
- Never use `chmod 666 /var/run/docker.sock`
- Document that membership in the `docker` group is effectively root-equivalent
- Store registry credentials using Electron `safeStorage`, never localStorage or plaintext JSON
- Redact credentials, tokens and environment secrets from logs
- Destructive actions must always show the exact affected resources and request confirmation

# Main UI

Reproduce the attached Harborlight interface with a left sidebar and the following sections:

1. Overview
2. Containers
3. Compose
4. Images
5. Volumes
6. Networks
7. Registry
8. Settings

Include:

- Harborlight logo and name
- Docker Engine connection status
- Global search with `Ctrl+K`
- Background task/activity indicator
- Notifications and actionable errors
- Light, Dark and System theme options
- Persistent theme preference
- Responsive desktop behavior
- Proper loading, empty, error and disconnected-engine states

The UI must prioritize desktop usage. It does not need to behave like a mobile application.

# Overview

Implement a real Overview page showing:

- Docker Engine status and version
- Active and stopped container counts
- CPU usage
- Memory usage
- Docker disk usage
- Images, volumes and networks counts
- Historical resource charts
- Recent container activity
- Recent failures
- Reclaimable disk space
- Quick actions such as Run Container, Pull Image, Open Compose Project and Cleanup

Use live Docker data when connected. Do not leave the production app dependent on fake dashboard values.

# Container management

Implement a complete Containers section with:

- Search and filtering
- Running, stopped, paused, restarting, unhealthy and exited states
- Grouping by Docker Compose project
- List and compact card views
- Container details drawer
- Inspect information
- Ports and published bindings
- Networks
- Mounts and volumes
- Environment variables with sensitive-value redaction
- Labels
- Health checks
- Restart policy
- Created time and uptime
- Live CPU, memory, network and block I/O stats

Container actions:

- Start
- Stop
- Restart
- Pause
- Unpause
- Kill
- Rename
- Inspect
- Open logs
- Open interactive shell
- Remove
- Force remove
- Optionally remove associated anonymous volumes
- Copy container ID, name and image
- Run a new container from the same image

Actions must report progress and errors. Do not optimistically show success before Docker confirms it.

# Interactive container terminal

Allow the user to enter a running container through a real interactive terminal.

Requirements:

- Use Docker Exec API with TTY support
- Use Xterm.js in the renderer
- Support terminal resize
- Try `/bin/bash`, then `/bin/sh`, then show a clear error
- Allow choosing the container user
- Allow choosing or entering a working directory
- Copy and paste
- Search terminal output
- Clear terminal
- Reconnect after a transient UI interruption when possible
- Display exit code
- Provide a warning before executing as root inside a container
- Never expose an unrestricted host shell in the initial version
- Do not persist terminal history by default

# Logs

Implement a dedicated logs experience:

- Live follow mode
- Pause and resume
- Tail line count
- Since and until filters
- Timestamps
- Search
- Literal and regular-expression search
- Invalid-regex handling
- Case-sensitive option
- Highlight matches
- Log-level filtering when recognizable
- Word wrap
- Copy selected lines
- Download/export logs
- Clear only the local view, never the container’s real logs
- Handle large streams without freezing the renderer
- Apply buffering and backpressure
- Show stdout and stderr distinctions when Docker provides them

# Compose Studio

Implement Compose project management:

- Open/import a `compose.yml`, `compose.yaml`, `docker-compose.yml` or `docker-compose.yaml`
- Discover running Compose projects from container labels
- YAML editor with validation
- Run `docker compose config`
- Show services, dependencies, networks, ports and volumes
- Interactive service topology
- Select a service from the topology
- Compose actions:

  - Up
  - Down
  - Start
  - Stop
  - Restart
  - Pull
  - Build
  - Rebuild
  - View logs
  - Open service shell

- Stream operation output
- Show clear command previews
- Run Compose commands without `shell: true`
- Confirm destructive `down --volumes` operations separately
- Preserve user files and never rewrite Compose YAML without explicit confirmation

# Images

Implement:

- Search and filters
- Pull image
- Run image
- Tag image
- Inspect image
- View layers/history
- Copy digest
- Remove image
- Force remove with explicit warning
- Identify which containers use an image
- Dangling and unused image indicators
- Image prune
- Optional vulnerability scanning when Trivy is installed
- Clear explanation when Trivy is unavailable
- Do not make Trivy mandatory for the initial installation

# Volumes and networks

Volumes:

- List
- Inspect
- Usage information when available
- Show related containers
- Remove an unused volume
- Prune unused volumes only through an explicit opt-in confirmation
- Never include volumes in a general cleanup by default

Networks:

- List
- Inspect
- Show connected containers
- Remove unused network
- Prune unused networks

# Cleanup tool

Create a safe cleanup workflow inspired by the reference image.

Before deleting anything, perform a dry-run-style analysis and show:

- Stopped containers
- Dangling images
- Unused images
- Unused networks
- Build cache
- Unused volumes as a separate, unchecked option
- Estimated reclaimable size per category
- Total estimated reclaimable size

The user must select categories and confirm them.

Never map the primary cleanup button directly to an unrestricted `docker system prune -a --volumes`.

After cleanup, show an operation summary with successful, skipped and failed items.

# Registry

Implement a minimal registry experience:

- List configured registries
- Docker Hub, GHCR and private OCI-compatible registry support
- Login and logout
- Pull by fully qualified reference
- Never display stored passwords or tokens
- Store secrets using Electron `safeStorage`
- Provide a clear locked/unavailable state if secure storage is unavailable

# Settings

Include:

- Theme: Light, Dark or System
- Docker socket/context selection
- Default local Docker socket
- Rootless Docker socket detection
- Polling interval
- Log defaults
- Default container shell
- Close to tray
- Start at login
- Start minimized
- Desktop notifications
- Update channel
- Check for updates
- Application version and Git commit SHA
- Diagnostics export with secret redaction

Detect these common sockets:

- `unix:///var/run/docker.sock`
- `unix:///run/user/<uid>/docker.sock`

Do not silently connect to an arbitrary TCP Docker daemon.

# System tray

Implement a real system tray integration for Ubuntu.

Tray menu:

- Open Harborlight
- Hide Harborlight
- Docker Engine status
- Open Containers
- Open Logs
- Check for Updates
- Start at Login toggle
- Launch Minimized toggle
- About
- Quit Harborlight

Behavior:

- Enforce a single running application instance
- Clicking the tray icon opens or focuses the window
- When “Close to tray” is enabled, closing the window hides it
- “Quit Harborlight” actually stops the application
- Autostart launches with `--hidden`
- Support Ubuntu AppIndicator/StatusNotifier behavior where Electron permits it
- Include required Ayatana/AppIndicator runtime dependency detection
- Explain GNOME tray limitations clearly in troubleshooting documentation
- Provide high-quality light and dark tray icons

# Installation

Create a root-level executable installer:

```bash
./install.sh install [options]
```

It must be idempotent and support:

```text
install
upgrade
uninstall
doctor
version
help
```

Installation options should include:

```text
--source local|release
--artifact <path>
--version <semver>
--channel stable|beta
--install-dir <path>
--bin-dir <path>
--target-user <username>
--desktop-entry
--no-desktop-entry
--autostart
--no-autostart
--start-minimized
--launch
--no-launch
--docker existing|install|skip
--compose existing|install|skip
--add-user-to-docker-group
--rootless
--socket <docker-socket>
--yes
--dry-run
--verbose
--force-unsupported
--purge
```

Installer behavior:

- Use `set -Eeuo pipefail`
- Detect Ubuntu version and architecture
- Print a complete installation plan before modifying the system
- Support `--dry-run`
- Prompt before privileged or security-sensitive changes unless `--yes` is used
- Use `SUDO_USER` safely when invoked with sudo
- Never launch Electron as root
- Install the application under `/opt/harborlight` by default
- Create `/usr/local/bin/harborlight`
- Install the `.desktop` entry
- Install application and tray icons
- Create per-user autostart under `~/.config/autostart` when requested
- Preserve user configuration on normal uninstall
- Remove user configuration only with `uninstall --purge`
- Verify checksums for downloaded release artifacts
- Never use `curl | bash`
- Never silently modify Docker socket permissions
- Warn before adding a user to the `docker` group
- Explain when logout/login is required
- Detect rootless Docker
- Provide rollback when installation fails midway
- Produce clear exit codes
- Keep an installation log without secrets
- Print exact post-install commands
- Verify the installed binary with `harborlight --version`
- Verify the desktop entry and autostart file when enabled

The installer should prefer a packaged `.deb` artifact. AppImage may be generated as an additional portable artifact.

# Local versus published installation semantics

The behavior must be unambiguous:

- Running `make install` inside a Git checkout installs the current local checkout.
- It must not silently run `git pull`.
- A freshly cloned or manually updated repository therefore installs that checked-out version.
- If the working tree is dirty, allow local installation but mark the version with a `dirty` suffix and display a warning.
- `make publish` must refuse a dirty working tree.
- A standalone `install.sh install --source release` installs the latest published version for the selected channel.
- Display the application version and Git SHA in Settings and `harborlight --version`.

# Makefile

Provide a clear root `Makefile`.

Required commands:

```bash
make help
make bootstrap
make dev
make stop
make logs
make doctor
make lint
make typecheck
make test
make test-e2e
make build
make package
make install
make uninstall
make publish
make clean
```

Required behavior:

## `make dev`

- Start the renderer and Electron in development mode
- Enable hot reload
- Use the real local Docker Engine by default
- Support mock mode through:

```bash
make dev MOCK=1
```

- Record development process IDs under `.run/`
- Write development logs under `.run/logs/`
- Be safe to run more than once
- If already running, report it instead of starting duplicate processes
- Keep enough process information so `make stop` can terminate only Harborlight development processes
- Never use a broad `pkill electron`, `pkill node` or similar command

## `make stop`

- Stop only the processes started by `make dev`
- Remove stale PID files
- Be idempotent
- Never stop unrelated Node.js, Electron or Docker processes

## `make logs`

- Follow the current development logs

## `make install`

Default behavior:

```bash
make install
```

It must:

1. Build/package the current local checkout.
2. Generate a version containing the package version and Git SHA.
3. Invoke `install.sh install --source local`.
4. Install or upgrade the existing OS installation.
5. Preserve user settings.
6. Verify the installed version.

Forward optional installer parameters through:

```bash
make install INSTALL_ARGS="--autostart --start-minimized --launch"
```

Also support useful variables when practical:

```bash
make install AUTOSTART=1 START_MINIMIZED=1
```

## `make publish`

Usage:

```bash
make publish VERSION=0.1.0 CHANNEL=stable
```

It must:

1. Require a clean Git working tree.
2. Validate semantic versioning.
3. Run linting, type checking, unit tests and packaging.
4. Build `.deb` and AppImage artifacts.
5. Generate SHA-256 checksums.
6. Generate a versioned release manifest.
7. Generate or update the `latest.json` manifest for the selected channel.
8. Include version, Git commit, date, architecture, download location and checksum.
9. Publish through a configurable provider.
10. Verify the published artifacts and manifest.
11. Never silently commit, tag or push without an explicit option.
12. Support a local dry run:

```bash
make publish VERSION=0.1.0 CHANNEL=stable PUBLISH_DRY_RUN=1
```

Inspect the repository’s Git remote before choosing a publishing provider. Keep publication provider-specific code behind an adapter.

At minimum, local publication must work and produce a complete release directory. If remote publication cannot be completed without repository credentials or hosting configuration, implement the provider interface, document the required variables, and fail with an actionable message rather than pretending publication succeeded.

# Packaging

Generate:

- Ubuntu `.deb`
- AppImage
- `checksums.sha256`
- Channel manifest
- Versioned release manifest
- Root `install.sh`

The `.deb` should install:

- Executable application
- Desktop entry
- Icons
- Required runtime integrations
- Version metadata

Build distributable Linux packages in a reproducible environment. Document architecture-specific limitations.

# Development safety

Automated tests must never delete real user Docker resources.

For integration tests:

- Create a uniquely named test Compose project
- Label all test resources
- Operate only on those labeled resources
- Clean them up after tests
- Never invoke unrestricted prune commands
- Provide a `DRY_RUN=1` mode
- Mock destructive operations in unit and E2E tests

# Documentation

Use Markdown documentation as a first-class project requirement.

Create and maintain:

```text
README.md
CONTRIBUTING.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
docs/INSTALLATION.md
docs/PUBLISHING.md
docs/DOCKER_OPERATIONS.md
docs/SECURITY.md
docs/TESTING.md
docs/TROUBLESHOOTING.md
docs/RELEASES.md
docs/DECISIONS.md
```

Documentation requirements:

## `README.md`

Include:

- What Harborlight is
- Screenshots or UI reference
- Supported Ubuntu versions
- Prerequisites
- Quick start
- `make dev`
- `make stop`
- `make install`
- Autostart example
- Basic troubleshooting
- Links to all detailed documentation

## `docs/ARCHITECTURE.md`

Document:

- Electron main/preload/renderer boundaries
- Typed IPC flow
- Docker Engine adapter
- Compose execution
- State management
- Security boundaries
- Background tasks
- Packaging
- Mermaid diagrams

## `docs/DEVELOPMENT.md`

Document exactly how to:

- Clone the repository
- Install dependencies
- Run `make dev`
- Use mock mode
- Stop with `make stop`
- Read logs
- Run tests
- Make UI changes
- Add a Docker operation
- Debug Electron main, preload and renderer processes

## `docs/INSTALLATION.md`

Document:

- All `install.sh` commands and parameters
- `make install`
- Local-source versus published installation
- Docker socket permissions
- Rootless Docker
- Autostart
- Desktop entry
- Upgrade
- Uninstall
- Purge
- Ubuntu-version-specific notes

## `docs/PUBLISHING.md`

Document:

- Versioning policy
- Required credentials and configuration
- `make publish`
- Dry-run publishing
- Release manifests
- Checksums
- Publishing provider
- How `install.sh --source release` finds the latest version
- Rollback procedure
- How to verify a release

## `docs/SECURITY.md`

Document:

- Docker socket risk
- Electron security
- IPC allowlist
- Secret storage
- Command execution rules
- Destructive action safeguards
- Registry credential handling

## `docs/TROUBLESHOOTING.md`

Include:

- Docker socket permission denied
- Docker Engine unavailable
- Rootless Docker
- App fails on Wayland
- Tray icon missing on GNOME
- Electron sandbox problems
- Compose command unavailable
- Installer rollback
- Stale development PID
- Port or process conflicts
- Application logs and diagnostic export

Whenever implementation behavior changes, update the relevant Markdown file in the same change.

# Quality requirements

- No placeholder buttons
- No controls that claim success without performing a real operation
- No fake production metrics
- No ignored TypeScript errors
- No `any` unless documented and unavoidable
- No swallowed errors
- No unbounded log buffers
- No application-wide root privileges
- No destructive Docker operation without confirmation
- Accessible keyboard navigation
- Visible focus states
- Appropriate ARIA labels
- Contrast that works in both themes
- Sensible empty and disconnected states
- Clear errors with recovery suggestions
- Long-running operations must support progress and cancellation where possible

# Testing

Implement tests for:

- IPC schema validation
- Docker adapter normalization
- Container action error handling
- Logs filtering and regex behavior
- Terminal lifecycle
- Compose argument construction
- Path validation
- Cleanup selection and confirmation
- Installer argument parsing
- Ubuntu version detection
- Installer dry-run
- Autostart file creation
- Desktop entry creation
- Make PID management
- Theme persistence
- Engine-disconnected UI
- System tray behavior where testable
- Package smoke test

Run and fix:

```bash
make lint
make typecheck
make test
make build
make package
```

Run E2E tests where the environment permits. If something cannot run in the current environment, document exactly why and provide the exact command for running it locally.

# Execution strategy

Work in vertical slices:

1. Inspect the repository and attached visual references.
2. Document architectural decisions in `docs/DECISIONS.md`.
3. Scaffold Electron, preload, renderer and shared types.
4. Implement the secure Docker connection and typed IPC.
5. Implement Overview and Containers using real Docker data.
6. Implement logs and interactive container terminal.
7. Implement images and cleanup.
8. Implement Compose Studio.
9. Implement volumes, networks, registry and settings.
10. Implement themes and match the reference PNG.
11. Implement tray, single-instance behavior and autostart.
12. Implement packaging and `install.sh`.
13. Implement Make targets.
14. Write and verify all documentation.
15. Run tests and perform a local smoke test.
16. Report completed work, remaining limitations and exact commands.

Do not postpone core functionality behind TODO comments. If the entire scope cannot be completed in one pass, finish a fully working and tested vertical slice first, but keep iterating until the requested project is complete.

# Acceptance criteria

A clean checkout must support this workflow:

```bash
git clone <repository-url>
cd harborlight

make bootstrap
make dev
make stop

make install INSTALL_ARGS="--autostart --start-minimized --launch"

harborlight --version
harborlight
```

Development workflow:

```bash
make dev
make logs
make stop
```

Publishing workflow:

```bash
make publish VERSION=0.1.0 CHANNEL=stable PUBLISH_DRY_RUN=1
make publish VERSION=0.1.0 CHANNEL=stable
```

Upgrade from the current checkout:

```bash
git pull --ff-only
make install
```

The installed application must:

- Appear in the Ubuntu application launcher
- Open as a normal desktop application
- Connect to the local Docker Engine
- Show real containers, images, networks and volumes
- Start, stop, restart and remove containers
- Open container logs
- Search and follow logs
- Open an interactive container shell
- Pull, run and remove images
- Perform selective cleanup safely
- Manage Compose projects
- Support Light and Dark Mode
- Remain available in the system tray when configured
- Start hidden at login when requested
- Display its exact version and Git commit
- Upgrade without destroying user configuration

# Final agent response

At the end, provide:

1. A concise summary of what was implemented.
2. The resulting architecture.
3. Important files created.
4. Commands executed.
5. Test results.
6. Known limitations.
7. Exact commands for:

   - Development
   - Stopping development
   - Installation
   - Installation with autostart
   - Publishing a dry-run release
   - Publishing a real release
   - Uninstalling

8. Confirmation that the Markdown documentation matches the implementation.

Do not claim a feature works unless you ran a relevant verification or clearly label it as unverified.
