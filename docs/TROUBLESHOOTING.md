# Troubleshooting

Start here:

```bash
./install.sh doctor      # or: make doctor
```

`doctor` checks the Ubuntu release, architecture, session type, Docker Engine, socket existence and
permissions, `docker` group membership, Compose v2, the installed binary, the desktop entry,
autostart and Trivy. It changes nothing. Most of the sections below are simply the long form of one
of its warnings.

## Contents

- [Docker socket permission denied](#docker-socket-permission-denied)
- [Docker Engine unavailable](#docker-engine-unavailable)
- [Rootless Docker is not detected](#rootless-docker-is-not-detected)
- [The app does not start on Wayland](#the-app-does-not-start-on-wayland)
- [Tray icon missing on GNOME](#tray-icon-missing-on-gnome)
- [Tray icon is hard to see](#tray-icon-is-hard-to-see)
- [Electron sandbox problems](#electron-sandbox-problems)
- [Compose command unavailable](#compose-command-unavailable)
- [Compose action fails with a path error](#compose-action-fails-with-a-path-error)
- [Terminal will not open in a container](#terminal-will-not-open-in-a-container)
- [Logs stop updating](#logs-stop-updating)
- [Registry login is not saved](#registry-login-is-not-saved)
- [Installer failed halfway](#installer-failed-halfway)
- [Stale development PID](#stale-development-pid)
- [Port or process conflicts](#port-or-process-conflicts)
- [Application logs and diagnostics](#application-logs-and-diagnostics)
- [Still stuck](#still-stuck)

## Docker socket permission denied

**Symptom.** The app shows "Permission denied while connecting to the Docker Engine", or
`docker info` in a terminal prints
`permission denied while trying to connect to the Docker daemon socket`.

**Cause.** `/var/run/docker.sock` is owned by `root:docker` with mode `0660`, and your user is not in
the `docker` group.

**Check.**

```bash
ls -l /var/run/docker.sock
id -nG | tr ' ' '\n' | grep -x docker && echo "in docker group" || echo "not in docker group"
```

**Fix — option A, the `docker` group.** Convenient, and how most Docker desktops work. Understand
that it grants root-equivalent access to your account:

```bash
sudo usermod -aG docker "$USER"
# then log out and back in, or start a new shell with:
newgrp docker
```

**Fix — option B, rootless Docker.** Better isolation, some feature differences. See
[Rootless Docker](#rootless-docker-is-not-detected) below and
[INSTALLATION.md](INSTALLATION.md#rootless-docker).

**What Harborlight will not do.** It never runs `chmod` on the socket and never elevates itself.
`sudo chmod 666 /var/run/docker.sock` "works" and is a bad idea: it gives every local process on the
machine root-equivalent access. Do not do it.

## Docker Engine unavailable

**Symptom.** "Cannot connect to the Docker Engine" and a red engine badge in the sidebar.

**Checks and fixes.**

```bash
systemctl is-active docker            # inactive → sudo systemctl start docker
systemctl is-enabled docker           # disabled → sudo systemctl enable --now docker
journalctl -u docker -n 50 --no-pager # why it failed to start
ls -l /var/run/docker.sock            # missing → the daemon is not running
docker info                           # the authoritative check
```

If Docker is not installed at all:

```bash
sudo apt-get install docker.io
sudo systemctl enable --now docker
```

Harborlight keeps polling and reconnects on its own as soon as the socket answers; there is also a
**Reconnect** button on the disconnected banner. If your socket is somewhere unusual, set it in
**Settings → Docker Engine → Custom socket path**.

## Rootless Docker is not detected

**Symptom.** You run rootless Docker, but Harborlight looks at `/var/run/docker.sock` and reports it
is unreachable.

**Cause.** The rootless socket lives at `/run/user/<uid>/docker.sock` and the user service must be
running.

**Fix.**

```bash
systemctl --user status docker
systemctl --user enable --now docker
echo "/run/user/$(id -u)/docker.sock"
```

Then set that path in **Settings → Docker Engine → Custom socket path**, or start Harborlight with
`DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock`. Harborlight probes `DOCKER_HOST`,
`/run/user/<uid>/docker.sock`, `$XDG_RUNTIME_DIR/docker.sock` and `/var/run/docker.sock` in that
order and lists what it finds in Settings.

Note that rootless containers cannot bind ports below 1024 or bind-mount arbitrary system paths.
Those failures come from Docker, not from Harborlight.

## The app does not start on Wayland

**Symptom.** Nothing appears, or the window is blank, or the terminal shows GBM/EGL errors.

**Checks.**

```bash
echo "$XDG_SESSION_TYPE"     # wayland or x11
harborlight                  # run from a terminal to see the errors
```

**Workarounds, in order of preference.**

1. Let Electron use XWayland (the default) — usually nothing to do.
2. Force X11 explicitly if compositing is broken:

   ```bash
   GDK_BACKEND=x11 harborlight
   ```

3. Native Wayland, if you prefer it:

   ```bash
   harborlight --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations
   ```

4. On a VM or a machine without working GPU drivers, disable acceleration:

   ```bash
   harborlight --disable-gpu
   ```

To make a workaround permanent, edit the `Exec=` line in a copy of the desktop entry placed at
`~/.local/share/applications/harborlight.desktop`; that overrides the system one and survives
upgrades.

## Tray icon missing on GNOME

**Symptom.** Close-to-tray works, but no icon appears in the top bar, so the window cannot be
restored.

**Cause.** GNOME Shell has not supported the legacy tray for years; it needs the AppIndicator
extension.

**Fix.**

```bash
sudo apt-get install gnome-shell-extension-appindicator
# log out and back in, then enable "Ubuntu AppIndicators" in the Extensions app
```

Ubuntu's default session ships this already; it is missing on vanilla GNOME sessions. Until it is
enabled, either turn off **Settings → Desktop → Close to tray**, or restore the window by launching
Harborlight again — the second launch focuses the existing instance instead of starting a new one.

## Tray icon is hard to see

**Symptom.** The icon is in the top bar but barely visible, or it does not change when you switch the
application theme.

**Cause.** The glyph has to contrast with the _panel_, which is not the same as the application
theme. Ubuntu keeps its top bar dark under both themes, so Harborlight keeps the pale glyph there
instead of following the theme — a dark glyph would disappear against it. On desktops whose panel
does follow the system theme, the automatic setting tracks it.

**Fix.** Force the variant in **Settings → Appearance → Tray icon**: `Pale` for a dark panel, `Dark`
for a light one. The change applies immediately, with no restart.

## Electron sandbox problems

**Symptom.**

```text
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc
The SUID sandbox helper binary was found, but is not configured correctly.
```

or, on Ubuntu 24.04 and newer, an error mentioning unprivileged user namespaces.

**Cause.** Chromium needs either unprivileged user namespaces (restricted by AppArmor on recent
Ubuntu) or a correctly-permissioned setuid helper.

**Fix for the `.deb`.** The package's `postinst` already sets this up. If something changed the file:

```bash
sudo chown root:root /opt/Harborlight/chrome-sandbox
sudo chmod 4755 /opt/Harborlight/chrome-sandbox
```

**Fix for the AppImage.** An AppImage cannot carry a SUID bit. Either install the `.deb` (supported)
or accept a weaker configuration:

```bash
./Harborlight-0.1.0-x86_64.AppImage --no-sandbox
```

**Running as root.** Harborlight refuses to run as root and tells you so. That is deliberate: it
leaves root-owned files in your home directory and defeats the sandbox. If you genuinely need it in
a controlled environment, use `--allow-root`.

## Compose command unavailable

**Symptom.** Compose Studio loads and shows your projects, but actions are disabled with "Docker
Compose v2 was not found".

**Check.**

```bash
docker compose version      # v2 plugin, what Harborlight needs
docker-compose --version    # the old Python script, not supported
```

**Fix.**

```bash
sudo apt-get install docker-compose-v2
```

Harborlight requires the v2 plugin because it builds `docker compose …` argument arrays. The legacy
`docker-compose` binary has different flags and is end-of-life.

## Compose action fails with a path error

**Symptom.** "Compose files must be named compose.yml, …" or "The file is outside the working
directory".

**Cause.** Compose paths are validated twice on purpose: the schema requires an absolute path with
no `..` and a Compose-shaped filename, and the runner then re-resolves the file and asserts it lives
inside the project's working directory. Symlinks that point outside the project are rejected.

**Fix.** Open the project from its own directory, and name the file `compose.yml`, `compose.yaml`,
`docker-compose.yml`, `docker-compose.yaml` or `<something>.compose.yml`. If you need to include a
file from elsewhere, use Compose's own `include:` or an override file inside the project.

## Terminal will not open in a container

**Symptom.** "No usable shell was found in this container."

**Cause.** Distroless, `scratch` and some minimal images genuinely contain no shell. Harborlight
probes `/bin/bash`, `/bin/sh` and `/bin/ash` and reports the failure instead of hanging.

**Options.**

- Set a specific shell in **Settings → Terminal → Default shell** if your image has one elsewhere
  (for example `/busybox/sh`).
- Inspect the filesystem without a shell: `docker cp <container>:/path ./local`.
- Attach a debug sidecar sharing the namespaces:
  `docker run -it --rm --pid container:<name> --network container:<name> busybox sh`.

## Logs stop updating

**Symptom.** The log view stops adding lines while the container is clearly still logging.

**Things to check.**

- The **Follow** toggle in the log toolbar. Scrolling up pauses follow on purpose; scroll back to
  the bottom or press Follow.
- An active search or level filter hiding new lines.
- The container may have restarted. The stream ends with a reason ("container exited",
  "stream closed"); reopening the container restarts it.
- Very chatty containers hit the buffer limit and the oldest lines are dropped. Reduce the tail size
  in **Settings → Logs**, or export the full log with the export button, which fetches a fresh
  non-following snapshot.

## Registry login is not saved

**Symptom.** "Secure storage is unavailable, so credentials cannot be saved."

**Cause.** Electron `safeStorage` needs an OS keyring (GNOME Keyring via libsecret, or KWallet). It
is missing or locked — common over SSH, in minimal desktops and in containers.

**Fix.**

```bash
sudo apt-get install gnome-keyring libsecret-1-0
# log out and back in so the keyring daemon starts and is unlocked
```

**Settings → Registry** shows which backend is in use. Harborlight will not fall back to writing
credentials in plain text; pulling public images continues to work without a login.

## Installer failed halfway

`install.sh` rolls back what it created — the launcher symlink, the autostart entry, temporary
downloads — and prints the log path:

```text
Installation log: /tmp/harborlight-install-XXXXXX.log
```

Read that log first. Then:

```bash
./install.sh doctor
dpkg -s harborlight                    # is the package installed at all?
sudo apt-get --fix-broken install      # unmet dependencies
./install.sh install --dry-run --verbose   # see exactly what it would do
```

If the package is half-installed, `sudo apt-get install -f` followed by
`sudo apt-get install ./dist/harborlight_<version>_<arch>.deb` is the usual repair. To start from a
clean state: `sudo ./install.sh uninstall` and install again.

## Stale development PID

**Symptom.** `make dev` prints "Harborlight dev is already running (pid N)" but no window appears,
or `make stop` says there is nothing to stop while Vite is clearly still serving.

**Cause.** `.harborlight/dev.pid` no longer matches a live process, usually after a crash or a
reboot.

**Fix.**

```bash
make stop                      # cleans up a stale PID file on its own
cat .harborlight/dev.pid       # inspect it
ps -p "$(cat .harborlight/dev.pid)" -o pid,cmd   # is it really ours?
rm -f .harborlight/dev.pid     # last resort
```

`make dev` records the process group id and `make stop` signals exactly that group, so neither
command can touch an unrelated Electron process — including an Electron-based editor. That is why
neither ever runs `pkill electron`, and why you should not either.

## Port or process conflicts

**Symptom.** The dev server fails with `EADDRINUSE`, or a container will not start because a host
port is taken.

**Development server.**

```bash
ss -ltnp | grep 5173           # who owns the Vite port
make stop                      # stop a session this checkout started
```

If another project owns the port, stop that project — Harborlight will not kill processes it did not
start.

**Container ports.**

```bash
ss -ltnp | grep 8080           # host process holding the port
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 8080
```

The Run-container dialog validates port numbers but cannot know what is already listening; Docker's
error is surfaced verbatim with the conflicting port.

**"Another instance is already running".** Harborlight takes a single-instance lock: launching it
again focuses the existing window. If a crashed instance leaves the lock behind:

```bash
pgrep -af '/opt/Harborlight/harborlight'
kill <pid>
```

## Application logs and diagnostics

| What                    | Where                                        |
| ----------------------- | -------------------------------------------- |
| Application log         | `~/.config/Harborlight/logs/harborlight.log` |
| Development session log | `.harborlight/dev.log` (`make logs`)         |
| Installer log           | `/tmp/harborlight-install-*.log`             |
| Renderer console        | DevTools in a development build              |

Raise verbosity:

```bash
HARBORLIGHT_LOG_LEVEL=debug harborlight
```

Lines are tagged by subsystem (`app`, `ipc`, `engine`, `docker`, `compose`, `security`, `registry`,
`cleanup`, `autostart`, `updates`), so `grep engine` narrows things quickly.

**Export diagnostics** from **Settings → About → Export diagnostics** writes a JSON bundle with the
app version and commit, platform information, engine status, socket probe results, redacted
settings, registry names (never secrets), active stream counts, background tasks and the last 200
log lines. The whole document goes through the redaction filter before being written, so it is safe
to attach to a bug report — but skim it anyway.

## Still stuck

Open an issue at <https://github.com/fmussad/Harborlight/issues> with:

1. `harborlight --version`
2. `lsb_release -d` and `uname -m`
3. `./install.sh doctor` output
4. The relevant part of the application log, or an exported diagnostics bundle
5. What you did, what you expected, and what happened

For anything security-sensitive, follow [SECURITY.md](SECURITY.md#reporting-a-vulnerability)
instead of opening a public issue.
