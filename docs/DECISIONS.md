# Architecture decision records

Short records of the decisions that shape Harborlight, why they were made, and what they cost. Each
one lists the alternatives that were considered and rejected, so a future change starts from the
reasoning rather than from scratch.

Format: **Context → Decision → Consequences → Rejected alternatives.** Status is `Accepted` unless
noted otherwise.

| #                                                                        | Decision                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| [001](#adr-001-electron-with-typescript-and-react)                       | Electron with TypeScript and React                        |
| [002](#adr-002-all-docker-access-lives-in-the-main-process)              | All Docker access lives in the main process               |
| [003](#adr-003-one-ipc-gateway-with-a-schema-backed-command-allowlist)   | One IPC gateway with a schema-backed command allowlist    |
| [004](#adr-004-ipc-returns-a-result-envelope-instead-of-throwing)        | IPC returns a result envelope instead of throwing         |
| [005](#adr-005-a-containerengine-interface-with-two-adapters)            | A `ContainerEngine` interface with two adapters           |
| [006](#adr-006-the-engine-api-over-the-docker-cli)                       | The Engine API over the Docker CLI                        |
| [007](#adr-007-compose-runs-through-the-docker-compose-cli)              | Compose runs through the `docker compose` CLI             |
| [008](#adr-008-never-touch-socket-permissions-never-run-as-root)         | Never touch socket permissions, never run as root         |
| [009](#adr-009-deb-is-the-primary-artifact-appimage-is-secondary)        | `.deb` is the primary artifact, AppImage is secondary     |
| [010](#adr-010-release-artifacts-are-verified-by-checksum-not-signature) | Release artifacts are verified by checksum, not signature |
| [011](#adr-011-updates-are-report-only)                                  | Updates are report-only                                   |
| [012](#adr-012-local-unix-sockets-only-for-now)                          | Local Unix sockets only, for now                          |
| [013](#adr-013-tanstack-query-for-server-state-zustand-for-ui-state)     | TanStack Query for server state, Zustand for UI state     |
| [014](#adr-014-cleanup-is-a-plan-not-a-prune)                            | Cleanup is a plan, not a prune                            |
| [015](#adr-015-credentials-go-to-the-os-keyring-or-nowhere)              | Credentials go to the OS keyring or nowhere               |
| [016](#adr-016-the-mock-engine-ships-in-production-builds)               | The mock engine ships in production builds                |
| [017](#adr-017-tailwind-v4-tokens-with-radix-primitives)                 | Tailwind v4 tokens with Radix primitives                  |
| [018](#adr-018-heavy-renderer-dependencies-are-lazy-loaded)              | Heavy renderer dependencies are lazy-loaded               |
| [019](#adr-019-make-is-the-single-entry-point-for-tooling)               | `make` is the single entry point for tooling              |

---

## ADR-001: Electron with TypeScript and React

**Context.** The project must be a desktop application on Ubuntu 22.04, 24.04 and 26.04, on amd64
and arm64, with a dense data UI: tables, live charts, a code editor, a topology graph and a real
terminal emulator. It must ship as a `.deb` and an AppImage.

**Decision.** Electron, TypeScript in strict mode, React 19, built with electron-vite.

**Consequences.** A ~100 MB package and ~200 MB installed, because Chromium is bundled. In exchange:
xterm.js, CodeMirror 6 and React Flow exist and are excellent; one toolchain covers all three
processes; the security model is well documented and testable; packaging for both architectures is a
solved problem. The size cost is paid once at install; the alternative was months of writing widgets.

**Rejected alternatives.**

- _GTK4 + libadwaita (Vala/Rust/Python)._ The most native option and the smallest binary, but there
  is no terminal widget with xterm.js's fidelity, no equivalent of CodeMirror's YAML tooling, and
  the graph view would have to be drawn by hand.
- _Tauri._ Much smaller binaries, but it depends on the system WebKitGTK, whose version and bugs
  differ across the three supported Ubuntu releases — exactly the variability a desktop app should
  not inherit. Revisit when WebKitGTK stabilises across LTS releases.
- _A web app plus a local daemon._ Two things to install, a long-lived privileged daemon, and a
  browser tab that can be reached by other pages. Strictly worse security for the same UI.

## ADR-002: All Docker access lives in the main process

**Context.** Whoever can write to the Docker socket controls the host. The renderer displays
untrusted strings from images, labels, logs and YAML.

**Decision.** The renderer never touches Docker. It runs sandboxed and context-isolated with no
Node.js integration, and reaches the engine only through IPC.

**Consequences.** Every operation needs a command, a schema and a handler — more ceremony than
calling Dockerode from a component. The payoff is that a renderer compromise (a malicious log line
exploiting a rendering bug, a supply-chain issue in a UI dependency) does not become host root; it
can only call commands that already exist with payloads that validate.

**Rejected alternatives.** `nodeIntegration: true` for convenience — this is the single most common
Electron vulnerability and would make the sandbox decorative.

## ADR-003: One IPC gateway with a schema-backed command allowlist

**Context.** A dozen `ipcMain.handle` calls scattered across modules drift: some validate, some do
not, and nobody can enumerate the renderer's capabilities.

**Decision.** A single `harborlight:invoke` channel. `commandSchemas` is simultaneously the
allowlist, the validator and the source of the payload types. Unknown commands are rejected before
dispatch, and every payload is parsed by Zod.

**Consequences.** The complete attack surface is one object you can read in a minute, and a unit
test asserts that every command has both a schema and a handler. Adding a command means touching the
contract first, which is exactly the review point you want.

**Rejected alternatives.** Per-feature channels (no central view, easy to forget validation);
hand-written type guards (drift from the types); trusting TypeScript types at the boundary (they do
not exist at runtime).

## ADR-004: IPC returns a result envelope instead of throwing

**Context.** Handlers threw `HarborlightError` with `code`, `hint` and `details`. Electron
serialises errors across the context bridge by keeping only `message` and `stack`, so the renderer
received "Error: invoking remote method…" and lost everything that made the error actionable. The
E2E tests caught this.

**Decision.** The gateway always resolves with `{ ok: true, data }` or
`{ ok: false, error: { code, message, hint, details } }`. The renderer's `invoke()` wrapper rethrows
a `UiError` built from that payload, so calling code still uses `try`/`catch`.

**Consequences.** One extra unwrapping layer, and E2E tests must check `response.ok` rather than
expect a rejection. In return, "permission denied" arrives with the hint that explains how to fix
it, and error codes can drive UI behaviour.

**Rejected alternatives.** Serialising errors into `message` and parsing them back (fragile);
subclassing `Error` and hoping (does not survive the bridge).

## ADR-005: A `ContainerEngine` interface with two adapters

**Context.** The UI must be developable and testable without a Docker daemon, and a remote or
Podman-compatible backend should not require rewriting the application.

**Decision.** One interface (`src/main/docker/engine.ts`) implemented by `DockerEngineAdapter` and
`MockEngineAdapter`. Adapters return normalized domain types, never raw Docker payloads.

**Consequences.** Adding an operation means implementing it twice, which TypeScript enforces. That
is a feature: mock mode never silently lags behind, and every operation gets a deterministic
fixture, which is what makes the E2E suite reliable.

**Rejected alternatives.** Calling Dockerode directly from handlers (untestable without a daemon,
Docker's shapes leak into the UI); mocking at the HTTP layer (tests the mock server more than the
app).

## ADR-006: The Engine API over the Docker CLI

**Context.** Everything except Compose can be done either by calling the Engine API or by shelling
out to `docker`.

**Decision.** Use the Engine API through Dockerode for containers, images, volumes, networks, logs,
exec, stats and prune.

**Consequences.** No CLI dependency, no output parsing, structured errors with real status codes,
and proper streaming for logs and exec. The cost is dealing with Docker's raw payload shapes, which
is confined to `normalize.ts` and covered by unit tests.

**Rejected alternatives.** Parsing `docker ps --format json` and friends: fragile across versions,
slower, and it means constructing command lines from user input — the exact thing this project
avoids.

## ADR-007: Compose runs through the `docker compose` CLI

**Context.** Compose is not part of the Engine API. Reimplementing dependency ordering, profiles,
build contexts and `depends_on` conditions would be a project of its own, and any divergence from
Compose's behaviour would be a bug.

**Decision.** Spawn `docker compose` with an argument array and `shell: false`. Build the arguments
in one pure, exhaustively tested function, and show the exact command before running it.

**Consequences.** Compose v2 becomes an optional runtime dependency; without it, Compose Studio is
read-only and says so. Command injection is structurally impossible, and users can copy the previewed
command into a terminal to reproduce exactly what the app did.

**Rejected alternatives.** Reimplementing Compose over the Engine API (guaranteed to diverge);
`exec` with a command string (injection risk); the legacy `docker-compose` Python script
(end-of-life, different flags).

## ADR-008: Never touch socket permissions, never run as root

**Context.** The most common "fix" for Docker permission errors on the internet is
`chmod 666 /var/run/docker.sock`, which grants every local process root-equivalent access. Many
desktop tools also happily run as root.

**Decision.** Harborlight never changes socket ownership or permissions, never installs a polkit
policy or setuid helper, and refuses to start as root (overridable with `--allow-root`). The
installer offers `usermod -aG docker` only after explaining that it grants root-equivalent access,
and always asks.

**Consequences.** Some users must take one extra step before the app is useful, and the app has to
explain that clearly — which is why permission errors carry a hint and `doctor` exists. The
alternative is a GUI that silently weakens the host's security.

**Rejected alternatives.** Running the whole app with `pkexec`; shipping a privileged helper
daemon; relaxing socket permissions on install.

## ADR-009: `.deb` is the primary artifact, AppImage is secondary

**Context.** The target is Ubuntu. Users expect an entry in the application menu, an icon, and
`apt` to know what is installed.

**Decision.** Ship a `.deb` with proper dependencies, a desktop entry, hicolor icons and
`postinst`/`postrm` scripts; ship an AppImage as a convenience for trying a build. Both are built
for amd64 and arm64 by electron-builder.

**Consequences.** `.deb` gets dependency resolution and a correctly permissioned `chrome-sandbox`;
AppImage cannot set the SUID bit and may need `--no-sandbox` on Ubuntu 24.04+, which is documented.
Snap and Flatpak are not produced: their confinement makes Docker socket access awkward, and they
would add two more build and review pipelines.

**Rejected alternatives.** Snap (strict confinement versus a root-equivalent socket is a bad fit);
Flatpak (same, plus portal complexity); a tarball (no menu entry, no dependency handling).

## ADR-010: Release artifacts are verified by checksum, not signature

**Context.** Users download binaries that will run with access to their Docker socket. Integrity
matters. GPG signing needs a key, a distribution story for the public key, and key rotation.

**Decision.** Every release publishes `checksums.sha256` covering all artifacts and `install.sh`,
and a `release.json` manifest that repeats each artifact's SHA-256. `install.sh --source release`
downloads over HTTPS, requires the checksum file, verifies the hash, and refuses to install on a
mismatch.

**Consequences.** This protects against corrupted or truncated downloads and against an artifact
being swapped without the manifest, but it does not prove authorship — an attacker who controls the
release page controls both files. Signing is the natural next step, tracked as a planned change:
`debsign` for the `.deb` plus a detached signature over `checksums.sha256`.

**Rejected alternatives.** No verification at all; verification "later" without saying so, which is
worse than being explicit about the limit.

## ADR-011: Updates are report-only

**Context.** Auto-update usually means a background service and an application that replaces its own
binary — for a tool with Docker access, on a system that has `apt`.

**Decision.** Harborlight checks a channel manifest, tells you whether a newer version exists, and
prints the upgrade command. It never downloads or installs an update. No endpoint is configured by
default, so a stock build makes no outbound request.

**Consequences.** Upgrading is one manual command. In exchange there is no updater service, no
self-replacing binary, no signature-verification gap in an automatic path, and no surprise
background traffic.

**Rejected alternatives.** `electron-updater` with `latest-linux.yml` (fine for AppImage, awkward
for a `.deb` that `apt` owns); an APT repository (a real option later — it would make `apt upgrade`
the update mechanism, which is the right long-term answer).

## ADR-012: Local Unix sockets only, for now

**Context.** Remote Docker over TCP or SSH is a common request. Done badly — a plain `tcp://` field
in Settings — it invites unauthenticated, unencrypted daemon access.

**Decision.** `normalizeSocketPath()` accepts only filesystem paths and `unix://` URLs, and rejects
`tcp://`, `http(s)://` and `ssh://` with an explanation. Rootless sockets are first-class.

**Consequences.** Remote hosts are not supported today. When they are, it will be behind an explicit
adapter with TLS client certificates or an SSH tunnel, a visible "remote" state in the UI, and its
own confirmation rules — not a text field.

**Rejected alternatives.** Accepting `DOCKER_HOST=tcp://…` silently, which is how people end up
exposing 2375 to a LAN.

## ADR-013: TanStack Query for server state, Zustand for UI state

**Context.** Docker state changes outside the app and must be polled or invalidated; UI state
(filters, selection, panels) is local and synchronous. Mixing them in one store leads to manual
cache invalidation everywhere.

**Decision.** TanStack Query owns everything that comes from the main process, with polling
intervals from settings and invalidation driven both by mutations and by main-process events.
Zustand owns UI state. React state owns transient form state.

**Consequences.** Three places to look for state, with a clear rule for which. Loading, error and
stale states come for free, and a change made in the tray menu or another window refreshes the UI
through the same invalidation path as a local action.

**Rejected alternatives.** Redux Toolkit (more ceremony, and RTK Query would replace TanStack Query
rather than complement it); everything in Zustand (hand-written caching and refetching); everything
in React state (prop drilling and duplicated fetches).

## ADR-014: Cleanup is a plan, not a prune

**Context.** `docker system prune -a --volumes` is the single most destructive command a Docker user
can run, and its output tells you what was deleted only afterwards.

**Decision.** Cleanup analyses first and shows every item by name and size, grouped by category.
Categories are ticked individually; volumes are a separate, unticked, flagged category and are
excluded from the headline "reclaimable" figure. A dry run is available. `docker system prune` is
never invoked; each category maps to its specific prune endpoint.

**Consequences.** Cleanup takes two clicks instead of one, and the analysis costs a `docker df` call
(cached for five minutes). Nobody loses a database volume to a button labelled "Clean up".

**Rejected alternatives.** A one-click "free space" button; defaulting volumes to selected.

## ADR-015: Credentials go to the OS keyring or nowhere

**Context.** Registry credentials are long-lived and often have push rights. Docker's own
`~/.docker/config.json` stores base64 — not encryption.

**Decision.** Encrypt with Electron `safeStorage` (libsecret/KWallet on Ubuntu) and store only
ciphertext, in a `0600` file written atomically. If no keyring is available, refuse to store the
credential and explain why.

**Consequences.** Users without a keyring (SSH sessions, minimal desktops) cannot save logins and
must pull public images or install `gnome-keyring`. That is the honest outcome; the alternative is a
"saved" credential that is trivially readable.

**Rejected alternatives.** Reusing `~/.docker/config.json` (base64 is not protection, and writing to
the Docker CLI's file is surprising); a passphrase-encrypted file (a second password to manage and
to leak).

## ADR-016: The mock engine ships in production builds

**Context.** A mock backend is normally a development-only artifact. Shipping one risks a user
mistaking demo data for their real host.

**Decision.** Ship it, make selecting it explicit (`HARBORLIGHT_ENGINE=mock` or a Settings toggle),
and badge the sidebar whenever it is active.

**Consequences.** A few hundred kilobytes of fixtures in the package. In exchange, the app is
demonstrable on a machine without Docker, a user can prove that a bug is in Docker access rather
than in the UI, and support can ask for a reproduction in mock mode. The badge and the explicit
opt-in make the demo state unmistakable.

**Rejected alternatives.** Stripping it at build time (then the shipped binary is not the one that
was tested with the mock, and the E2E suite would have to run against real Docker).

## ADR-017: Tailwind v4 tokens with Radix primitives

**Context.** The UI must match a specific design in light and dark themes, be dense, and be
accessible: focus rings, keyboard navigation, correct ARIA for menus, dialogs and tabs.

**Decision.** Tailwind v4 with semantic CSS custom properties (`bg-surface`, `text-muted`,
`border-subtle`, …) defined per theme, on top of unstyled Radix primitives for dialogs, menus,
tooltips, tabs, switches and the rest.

**Consequences.** No hard-coded colours anywhere, so a theme change is a token change and both
themes stay correct by construction. Radix supplies the accessibility behaviour that is tedious and
easy to get wrong, without imposing a visual style.

**Rejected alternatives.** A component library with its own look (fighting it costs more than
building on primitives); hand-rolled dialogs and menus (focus traps and ARIA are a lot of subtle
work); CSS-in-JS (a runtime cost and a CSP complication).

## ADR-018: Heavy renderer dependencies are lazy-loaded

**Context.** CodeMirror, React Flow and xterm.js together dominate the bundle, yet most sessions
never open the Compose editor or a terminal.

**Decision.** Load them through `React.lazy` at the point of use: the Compose page as a whole, and
the terminal pane on demand.

**Consequences.** A visible skeleton for a moment when a heavy view is first opened, in exchange for
a much smaller initial bundle and a faster cold start. Route-level splitting keeps the boundaries
few and obvious.

**Rejected alternatives.** One bundle (slow first paint for features most sessions never use);
manual `import()` scattered through components (harder to reason about than a lazy boundary).

## ADR-019: `make` is the single entry point for tooling

**Context.** Contributors should not have to memorise npm script names, environment variables and
shell invocations, and the documentation should be able to name one command per task.

**Decision.** A `Makefile` with a self-documenting `help` target wraps everything: bootstrap, dev,
stop, logs, doctor, lint, typecheck, test, e2e, build, package, icons, install, uninstall, publish,
clean. Non-trivial targets delegate to small shell scripts in `scripts/` so the logic is testable and
readable.

**Consequences.** Two layers (Make plus scripts), but every task has one obvious command, and the
scripts remain usable on their own. Session management goes through PID files and process groups so
that `make stop` can never kill an unrelated Electron process.

**Rejected alternatives.** npm scripts only (no discoverability, awkward for multi-step shell
logic); a task runner dependency (one more thing to install before you can build).
