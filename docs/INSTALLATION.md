# Installation

Harborlight installs as a normal Debian package into `/opt/Harborlight`, with a launcher at
`/usr/local/bin/harborlight` and a desktop entry at `/usr/share/applications/harborlight.desktop`.
`install.sh` wraps that with environment checks, a printed plan, confirmations, verification and
rollback.

## Contents

- [Ways to install](#ways-to-install)
- [install.sh reference](#installsh-reference)
- [Local source versus published release](#local-source-versus-published-release)
- [Docker socket permissions](#docker-socket-permissions)
- [Rootless Docker](#rootless-docker)
- [Autostart](#autostart)
- [Desktop entry](#desktop-entry)
- [Upgrading](#upgrading)
- [Uninstalling and purging](#uninstalling-and-purging)
- [What lands where](#what-lands-where)
- [Ubuntu-specific notes](#ubuntu-specific-notes)
- [Exit codes](#exit-codes)

## Ways to install

### From this checkout (recommended while there are no published releases)

```bash
make install
```

That builds the packages and runs `./install.sh install --source local`. Useful variants:

```bash
make install YES=1                                      # no prompts
make install AUTOSTART=1 START_MINIMIZED=1 LAUNCH=1     # start at login, hidden, launch now
make install INSTALL_ARGS="--autostart --start-minimized --launch"
```

`INSTALL_ARGS` is passed to `install.sh` verbatim, so anything in the reference below works.

### From a published release

```bash
./install.sh install --source release --channel stable
./install.sh install --source release --channel stable --version 0.1.0
```

The release path downloads the `.deb` for your architecture **and** `checksums.sha256`, verifies the
SHA-256 before installing, and refuses to continue if the checksum file is missing or does not
match.

### From a file you already have

```bash
./install.sh install --artifact ~/Downloads/harborlight_0.1.0_amd64.deb
```

### With dpkg directly

Nothing stops you from bypassing the installer:

```bash
sudo apt-get install ./dist/harborlight_0.1.0_amd64.deb
```

You then miss the environment checks, autostart handling and verification, but the package itself is
self-contained.

### AppImage

```bash
chmod +x Harborlight-0.1.0-x86_64.AppImage
./Harborlight-0.1.0-x86_64.AppImage
```

The AppImage does not install a desktop entry and does not integrate with autostart. It is handy for
trying a build; the `.deb` is the supported way to install.

## install.sh reference

```text
./install.sh <command> [options]
```

### Commands

| Command     | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| `install`   | Install or reinstall. Idempotent; safe to run repeatedly.        |
| `upgrade`   | Alias for `install`.                                             |
| `uninstall` | Remove Harborlight, keeping user settings unless `--purge`.      |
| `doctor`    | Check the environment and report what is wrong. Changes nothing. |
| `version`   | Show installer, installed package and binary versions.           |
| `help`      | Full usage.                                                      |

### Options

| Option                                   | Default                         | Description                                                                 |
| ---------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `--source local\|release`                | `local`                         | Take the `.deb` from `dist/`, or download a release.                        |
| `--artifact <path>`                      | —                               | Install this specific `.deb`. Overrides `--source`.                         |
| `--version <semver>`                     | latest                          | Release version to fetch with `--source release`.                           |
| `--channel stable\|beta`                 | `stable`                        | Release channel.                                                            |
| `--install-dir <path>`                   | `/opt/Harborlight`              | Reserved; the `.deb` decides the real location.                             |
| `--bin-dir <path>`                       | `/usr/local/bin`                | Where the `harborlight` launcher symlink is created.                        |
| `--target-user <user>`                   | invoking user (or `$SUDO_USER`) | Whose autostart and permissions are configured.                             |
| `--desktop-entry` / `--no-desktop-entry` | entry installed                 | Keep or remove the application-menu entry.                                  |
| `--autostart` / `--no-autostart`         | no autostart                    | Write or remove `~/.config/autostart/harborlight.desktop`.                  |
| `--start-minimized`                      | off                             | With `--autostart`, launch hidden in the tray (`--hidden`).                 |
| `--launch` / `--no-launch`               | no launch                       | Start Harborlight when the installation finishes.                           |
| `--docker existing\|install\|skip`       | `existing`                      | Check Docker, install `docker.io`, or ignore Docker entirely.               |
| `--compose existing\|install\|skip`      | `existing`                      | Same for the `docker-compose-v2` plugin.                                    |
| `--add-user-to-docker-group`             | off                             | Add the target user to `docker` (asks first, warns about the consequences). |
| `--rootless`                             | off                             | Assume the rootless socket `/run/user/<uid>/docker.sock` for checks.        |
| `--socket <path>`                        | —                               | Use this socket path in checks.                                             |
| `--yes`, `-y`                            | off                             | Accept every confirmation. Required for non-interactive use.                |
| `--dry-run`                              | off                             | Print the full plan and every command, change nothing.                      |
| `--verbose`                              | off                             | Echo each command as it runs.                                               |
| `--force-unsupported`                    | off                             | Install on a distribution or release that is not supported.                 |
| `--purge`                                | off                             | With `uninstall`, also delete settings and stored credentials.              |

### Always look before you leap

```bash
./install.sh install --dry-run --autostart --start-minimized
```

A dry run prints the resolved plan — source, artifact, version, architecture, install directory,
launcher, desktop entry, autostart, target user, Docker mode and socket, whether the docker group
would change — and then every command it _would_ run, prefixed with `dry-run`. Nothing is executed.

The same plan is printed (and confirmed) during a real install, so you always see what is about to
happen before it does.

### What the installer will not do

- It never runs the desktop application as root, and refuses to launch it as root.
- It never changes the permissions or ownership of the Docker socket.
- It never adds a third-party APT repository. `--docker install` uses Ubuntu's own `docker.io`
  package and points you at Docker's documentation if you want their packages.
- It never deletes user data unless you pass `--purge` and confirm.
- It is not designed to be piped from the internet into a shell. Clone the repository or download
  the release and read the script first.

### Rollback

If a step fails partway through, the `ERR` trap undoes what has been done so far — the launcher
symlink, the autostart file and any temporary download directory — and prints the log location. The
`.deb` itself is installed through `apt-get`, so dpkg's own transactional behaviour applies to the
package contents.

Every run writes a timestamped log to `/tmp/harborlight-install-XXXXXX.log`, and prints the path at
the end.

## Local source versus published release

|                             | `--source local`                | `--source release`                                       |
| --------------------------- | ------------------------------- | -------------------------------------------------------- |
| Where the `.deb` comes from | newest matching file in `dist/` | GitHub release for the channel/version                   |
| Requires a build            | yes (`make package`)            | no                                                       |
| Checksum verification       | not applicable (you built it)   | mandatory; refuses to install without `checksums.sha256` |
| Network access              | none                            | HTTPS to GitHub                                          |
| Typical user                | contributors, custom builds     | everyone else                                            |

`--source release` resolves the URL as
`https://github.com/fmussad/Harborlight/releases/latest/download/harborlight_<arch>.deb`, or the
tagged directory when `--version` is given. Override the base with `HARBORLIGHT_RELEASE_BASE_URL`
when testing against a local server (see [PUBLISHING.md](PUBLISHING.md)).

## Docker socket permissions

Harborlight talks to `/var/run/docker.sock`. That socket is root-owned and group-owned by `docker`,
and **anything that can write to it can take over the host**. Harborlight therefore never changes it
for you. Pick the trade-off consciously:

| Option                              | Command                                                    | Trade-off                                                                                         |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Add your user to the `docker` group | `sudo usermod -aG docker "$USER"` then log out and back in | Convenient. Grants root-equivalent access to your account. This is how most Docker desktops work. |
| Rootless Docker                     | see below                                                  | Best isolation. Some features (host networking, privileged ports below 1024) behave differently.  |
| Per-command `sudo`                  | not supported by Harborlight                               | A GUI cannot prompt for sudo per Docker call without becoming a privilege-escalation vector.      |

`install.sh --add-user-to-docker-group` will do the first option for you, but only after telling you
exactly what it means and asking. Group membership takes effect at your next login (or after
`newgrp docker` in a shell).

Verify with:

```bash
./install.sh doctor
docker info >/dev/null && echo "socket reachable"
```

## Rootless Docker

```bash
sudo apt-get install -y uidmap docker-ce-rootless-extras   # or dockerd-rootless-setuptool.sh
dockerd-rootless-setuptool.sh install
systemctl --user enable --now docker
```

The rootless socket is `/run/user/$(id -u)/docker.sock`. Point Harborlight at it in either place:

- **Settings → Docker Engine → Custom socket path**, or
- at install time: `./install.sh install --rootless` (used for the installer's own checks), or
  `--socket /run/user/1000/docker.sock`.

Harborlight also probes common socket locations at startup and offers what it finds in Settings, so
in most cases rootless is detected without configuration. Rootless mode restricts what containers
can do — that is the point — so bind mounts of system paths and low ports may fail where they
worked before.

## Autostart

Enable at install time:

```bash
make install INSTALL_ARGS="--autostart --start-minimized"
```

or toggle later in **Settings → Desktop → Start at login** and **Start minimised**, or from the tray
menu. All three write the same file:

```ini
# ~/.config/autostart/harborlight.desktop
[Desktop Entry]
Type=Application
Name=Harborlight
GenericName=Container Manager
Comment=Container workflows, reimagined for Ubuntu
Exec=/usr/local/bin/harborlight --hidden
Icon=harborlight
Terminal=false
Categories=Development;System;
StartupWMClass=harborlight
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
```

The five-second delay keeps Harborlight from racing the Docker service and the tray extension during
login. When the app writes the file itself it uses its own executable path (the AppImage path when
running as an AppImage), which is why the `Exec` line can differ from the example above.

`--hidden` is present only when start-minimised is on; the app then starts in the tray with no
window. Remove autostart with `./install.sh install --no-autostart`, by toggling the setting off, or
by deleting the file.

For the tray icon to be visible on GNOME you need the AppIndicator extension — see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#tray-icon-missing-on-gnome).

## Desktop entry

The `.deb` installs `/usr/share/applications/harborlight.desktop`:

```ini
[Desktop Entry]
Name=Harborlight
Exec=/opt/Harborlight/harborlight %U
Icon=harborlight
Type=Application
Terminal=false
GenericName=Container Manager
Categories=Development;System;
Keywords=docker;container;compose;devops;
StartupNotify=true
StartupWMClass=harborlight
```

`StartupWMClass` matches Electron's window class, so GNOME shows one icon in the dash instead of a
duplicate generic entry. Icons are installed into `/usr/share/icons/hicolor/<size>/apps/` for sizes
16 through 1024, and the package's `postinst` refreshes the desktop and icon caches.

Install without the entry using `--no-desktop-entry` (the file is removed after the package is
installed).

## Upgrading

From a checkout:

```bash
git pull --ff-only
make install
```

From a release:

```bash
./install.sh upgrade --source release --channel stable
```

Upgrades replace the package contents only. `~/.config/Harborlight/` — settings, registries,
credentials, usage history — is never touched, so preferences and logins survive. If a future
release needs to migrate the settings file, the settings loader validates and fills in defaults
rather than failing.

Check what you are running:

```bash
harborlight --version
./install.sh version
```

## Uninstalling and purging

```bash
sudo ./install.sh uninstall            # keeps ~/.config/Harborlight
sudo ./install.sh uninstall --purge    # also deletes settings and stored credentials (asks first)
make uninstall
```

`uninstall` removes the package, the `/usr/local/bin/harborlight` symlink and the autostart file.
`--purge` additionally removes `~/.config/Harborlight` and `~/.cache/Harborlight` for the target
user, after an explicit confirmation. Docker itself, your containers, images and volumes are never
touched by either.

## What lands where

| Path                                              | Owner | Created by               |
| ------------------------------------------------- | ----- | ------------------------ |
| `/opt/Harborlight/`                               | root  | `.deb`                   |
| `/usr/local/bin/harborlight`                      | root  | `install.sh` (symlink)   |
| `/usr/share/applications/harborlight.desktop`     | root  | `.deb`                   |
| `/usr/share/icons/hicolor/*/apps/harborlight.png` | root  | `.deb`                   |
| `~/.config/Harborlight/`                          | user  | the app on first run     |
| `~/.config/autostart/harborlight.desktop`         | user  | `install.sh` or Settings |
| `/tmp/harborlight-install-*.log`                  | user  | `install.sh`             |

## Ubuntu-specific notes

### 22.04 LTS (Jammy)

- Ships Docker 20.10 via `docker.io`; Compose v2 is available as `docker-compose-v2`. If you only
  have the old `docker-compose` Python script, Compose Studio stays read-only — Harborlight requires
  the v2 plugin.
- The default session is Wayland on GNOME 42; both Wayland and X11 work.

### 24.04 LTS (Noble)

- AppArmor restricts unprivileged user namespaces, which is what Electron's sandbox uses. The
  package's `postinst` sets the SUID bit on `chrome-sandbox` (`root:root`, mode `4755`), which is
  what Chromium expects, so the sandbox works without disabling AppArmor.
- If you run the **AppImage** on 24.04 and it fails to start with a namespace error, either run it
  with `--no-sandbox` (weaker) or install the `.deb`, which is the supported path.

### 26.04 LTS

- Supported and tested against the same code path as 24.04. Should Ubuntu change the AppArmor
  defaults again, `install.sh doctor` reports the sandbox state.

### Other distributions

`install.sh` stops with exit code 3 on anything that is not Ubuntu 22.04, 24.04 or 26.04. The
package is a plain Electron application, so Debian-based systems usually work with
`--force-unsupported`; it is simply not tested and not supported.

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | Success                                                               |
| 2    | Usage error (unknown command, bad flag, invalid value)                |
| 3    | Unsupported platform or architecture                                  |
| 4    | Missing dependency (for example `curl` for a release install)         |
| 5    | Artifact problem (not found, download failed)                         |
| 6    | Privilege problem                                                     |
| 7    | Verification failed (checksum mismatch, binary missing after install) |
| 8    | Aborted by the user                                                   |
