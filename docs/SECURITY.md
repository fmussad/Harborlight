# Security

Harborlight is a graphical front end for a socket that grants root-equivalent control of your
machine. This document explains the risk that creates, what the application does about it, and where
the boundaries are.

## Contents

- [The Docker socket is the whole threat model](#the-docker-socket-is-the-whole-threat-model)
- [Electron hardening](#electron-hardening)
- [The IPC allowlist](#the-ipc-allowlist)
- [Command execution rules](#command-execution-rules)
- [Registry credentials](#registry-credentials)
- [Secrets in the UI](#secrets-in-the-ui)
- [Destructive action safeguards](#destructive-action-safeguards)
- [Privileges and root](#privileges-and-root)
- [Network behaviour](#network-behaviour)
- [Packaging and the Electron sandbox](#packaging-and-the-electron-sandbox)
- [What is verified, and how](#what-is-verified-and-how)
- [Reporting a vulnerability](#reporting-a-vulnerability)

## The Docker socket is the whole threat model

Access to `/var/run/docker.sock` is equivalent to root on the host: anyone who can write to it can
start a privileged container that mounts `/` and read or modify anything. This is a property of
Docker, not of Harborlight, and no desktop client can make it untrue.

What follows from that:

| Decision                                               | Reason                                                                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only the main process touches the socket.              | The renderer parses untrusted content (image names, labels, log output, YAML). Keeping it away from the socket means a renderer compromise is not automatically a host compromise.                             |
| The renderer's capabilities are an explicit allowlist. | Even a fully compromised renderer can only issue commands that already exist, with payloads that pass validation.                                                                                              |
| Harborlight never changes socket permissions.          | Whether your user gets root-equivalent access is your decision, taken deliberately, not a side effect of installing a GUI.                                                                                     |
| Harborlight never elevates itself.                     | No polkit agent, no `sudo` wrapper, no setuid helper. `install.sh` asks for `sudo` for package installation only, and the application refuses to run as root.                                                  |
| Remote daemons are not supported yet.                  | A remote adapter needs TLS client certificates and a trust model; shipping "just point it at tcp://" would be worse than not shipping it. `normalizeSocketPath()` rejects `tcp://`, `http(s)://` and `ssh://`. |

## Electron hardening

Window configuration (`src/main/windows/mainWindow.ts`):

| Setting                       | Value                                    | Effect                                           |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `sandbox`                     | `true`                                   | The renderer runs in the OS sandbox.             |
| `contextIsolation`            | `true`                                   | Preload and page share no JavaScript context.    |
| `nodeIntegration`             | `false` (also in workers and sub-frames) | No `require`, no `process`, no `fs` in the page. |
| `webSecurity`                 | `true`                                   | Same-origin policy enforced.                     |
| `allowRunningInsecureContent` | `false`                                  | No mixed content.                                |
| `experimentalFeatures`        | `false`                                  | No unshipped web platform features.              |
| `devTools`                    | development builds only                  | DevTools are unavailable in a packaged build.    |

Session-level policies:

- **Content Security Policy**, sent as a header on every response and duplicated in the document:

  ```text
  default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
  media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'self' blob:;
  base-uri 'self'; form-action 'none'; frame-ancestors 'none'
  ```

  There is no `unsafe-eval` anywhere and no remote origin is allowed in production. `unsafe-inline`
  is required for `style-src` only, because CodeMirror, xterm.js and React Flow inject `<style>`
  elements at runtime; scripts remain restricted to `'self'`. In development the Vite dev server
  origin is added, and only then.

- **Navigation is pinned.** `will-navigate` is blocked unless the target is the bundle itself
  (`file://`, or the dev server URL during development).
- **`window.open` is denied.** External links go through `system.openExternal`, which accepts only
  HTTPS URLs whose host is on a small allowlist (GitHub, Docker docs and Hub, GHCR, Ubuntu docs,
  Trivy docs, the Harborlight docs site). Everything else is refused with an explanation.
- **`<webview>` attachment is blocked** outright.
- **All device permissions are denied**: camera, microphone, geolocation, notifications, clipboard
  read, USB, MIDI, everything. Both the permission request handler and the permission check handler
  return `false`.
- **`X-Content-Type-Options: nosniff`** on every response.

The preload script exposes exactly three functions — `invoke`, `on`, `off` — over `contextBridge`.
It contains no business logic and no Node.js re-exports.

## The IPC allowlist

Every renderer→main call goes through one gateway (`src/main/ipc/registry.ts`) that applies four
checks in order:

1. **Sender check.** The calling frame's URL must be our own bundle (`file://`, `devtools://`, or
   `localhost`/`127.0.0.1` during development). An unexpected frame is rejected as `not-allowed`.
2. **Allowlist check.** The command must be a key of `commandSchemas`. Anything else is rejected
   before a handler is looked up — there is no dynamic dispatch, no `eval`, no string-to-function
   mapping.
3. **Schema validation.** The payload is parsed with that command's Zod schema. Types, ranges,
   formats and defaults are all enforced here: image references must match a strict pattern, paths
   must be absolute with no `..` and no control characters, container names must match Docker's
   grammar, timeouts are bounded, log tails are bounded, signals are an enum of four values.
4. **Handler execution** with a validated payload and a typed result.

Failures return a structured envelope (`{ ok: false, error: { code, message, hint, details } }`)
rather than a thrown `Error`, because Electron strips custom properties from errors crossing the
context bridge. The renderer converts it back into a `UiError`, which is how the UI can show an
actionable hint instead of a raw errno.

Rejections are logged with the command name and the reason, at `warn` level, tagged `ipc`.

## Command execution rules

Harborlight spawns exactly two external programs: `docker compose` and, when installed, `trivy`.

- **Always an argument array.** `spawn(program, args, { shell: false })`. No string concatenation,
  no `exec`, no `sh -c`.
- **No inherited shell environment tricks.** The child inherits the environment but is never given a
  command line a shell could reinterpret.
- **Paths are validated before use** and re-checked against the working directory
  (`src/main/compose/paths.ts`).
- **A container's `Cmd`** entered in the "Run container" dialog is tokenized by a small POSIX-style
  tokenizer (`src/main/docker/command.ts`) into an array that goes straight to the Engine API. It is
  never handed to a shell — quoting behaves the way you would expect, but `;`, `&&` and backticks
  are literal characters.
- **Timeouts and output limits** apply to every child process, and long operations are cancellable.

## Registry credentials

- Secrets are encrypted with Electron `safeStorage`, which on Ubuntu uses libsecret (GNOME Keyring)
  or KWallet. Only the ciphertext, base64-encoded, is written to
  `~/.config/Harborlight/registries.json`, atomically and with mode `0600`.
- **If no keyring is available, Harborlight refuses to store the credential** and says why, instead
  of silently writing plain text. Pulling public images continues to work.
- Plaintext exists only in main-process memory: during the login call, and for the duration of a
  pull that needs it. It is never sent to the renderer, never logged, and never included in
  diagnostics. The renderer only sees `hasCredentials: true`.
- `registry.status` reports the backend in use so you can tell whether your secrets are protected by
  a locked keyring or an unlocked one.

## Secrets in the UI

Container environment variables frequently contain tokens. With
**Settings → Security → Redact environment secrets** (on by default), values whose keys look
sensitive — `*PASSWORD*`, `*SECRET*`, `*TOKEN*`, `*_KEY`, `AUTH*`, credentials embedded in
connection strings — are replaced with `••••••` in the details panel, in inspect output and in
exported diagnostics. The rules live in `src/shared/utils/redact.ts` and are unit tested, including
the case of a URL with an inline password.

Diagnostics exports pass the whole report through `redactDeep()` twice: once on the settings object
and once on the assembled report.

## Destructive action safeguards

| Operation                | Safeguard                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove container         | Confirmation listing the container(s). Force-removing a running container additionally requires typing its name.                                                                                   |
| Remove container volumes | A separate, unticked checkbox inside the same dialog.                                                                                                                                              |
| Kill (SIGKILL)           | Confirmation explaining that the process gets no chance to shut down.                                                                                                                              |
| Remove image             | Confirmation listing the tags that will disappear.                                                                                                                                                 |
| Remove volume            | Confirmation stating that the data cannot be recovered.                                                                                                                                            |
| Remove network           | Confirmation; system networks cannot be removed at all.                                                                                                                                            |
| Cleanup                  | Two-step: analyse, then remove only ticked categories. Volumes are a separate dangerous category, unticked by default and excluded from the headline "reclaimable" figure. A dry run is available. |
| `compose down`           | Requires `confirmedDestructive: true`; `--volumes` requires a second, explicit confirmation.                                                                                                       |
| Compose file save        | Requires `confirmed: true` and a validated path inside the project directory.                                                                                                                      |

`docker system prune` is never invoked.

**Settings → Safety → Confirm destructive actions** (on by default) can silence the recoverable
prompts — stopping, killing, removing a stopped container. It cannot silence a prompt that asks you
to type a name, which is exactly the set of actions that destroy data: force-removing a running
container, deleting a volume, pruning unused volumes and `compose down --volumes`.

## Privileges and root

- The application refuses to start as root and explains why. `--allow-root` (or
  `HARBORLIGHT_ALLOW_ROOT=1`) exists for controlled environments such as CI containers.
- `install.sh` uses `sudo` only for package installation, the launcher symlink and (if you ask for
  it) `usermod -aG docker`. User-level files — autostart entries, settings — are written as the
  target user, never as root, so no root-owned files are left in your home directory.
- The installer never adds an APT repository and never pipes anything into a shell.

## Network behaviour

Harborlight makes no outbound connections of its own except:

| Connection                   | When                                      | Can be disabled  |
| ---------------------------- | ----------------------------------------- | ---------------- |
| Docker registry traffic      | You pull an image                         | Do not pull      |
| Update check                 | Manually, or at startup if you enable it  | Yes, in Settings |
| Trivy vulnerability database | You scan an image, and Trivy is installed | Do not scan      |

There is no telemetry, no analytics, no crash reporting and no remote logging. The renderer's CSP
`connect-src 'self'` means the UI itself cannot reach the network at all.

## Packaging and the Electron sandbox

The Chromium sandbox needs either unprivileged user namespaces or a setuid helper. Ubuntu restricts
the former, so the `.deb`'s `postinst` sets `/opt/Harborlight/chrome-sandbox` to `root:root` with
mode `4755`, which is what Chromium expects. Harborlight does not ship a `--no-sandbox` launcher and
does not ask you to disable AppArmor.

AppImage builds cannot set a SUID bit, so on systems where unprivileged user namespaces are
restricted the AppImage may need `--no-sandbox`. That is a weaker configuration; the `.deb` is the
supported way to install.

## What is verified, and how

The security properties above are not just prose — the Playwright suite (`tests/e2e/security.spec.ts`)
asserts them against a real packaged-style build:

| Property                                                       | Test                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Context isolation and sandbox are on, `nodeIntegration` is off | Reads the window's `webPreferences` in the main process.                                          |
| The renderer has no Node.js                                    | `require`, `process` and `module` are undefined in the page.                                      |
| CSP is enforced                                                | Injecting an inline `<script>` does not execute, and the policy contains the expected directives. |
| Unknown commands are rejected                                  | `invoke('evil.command')` returns `ok: false` with code `not-allowed`.                             |
| Payloads are validated                                         | A malformed payload returns `ok: false` with code `validation`.                                   |
| External URLs are filtered                                     | A non-allowlisted URL is refused by `system.openExternal`.                                        |
| Device permissions are denied                                  | A geolocation request is rejected.                                                                |

Unit tests additionally cover redaction, Compose argument construction, path validation and the IPC
contract (every command has a schema; the allowlist matches the handler map).

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's
"Report a vulnerability" flow on <https://github.com/fmussad/Harborlight/security/advisories>, or by
opening a minimal issue that asks for a private channel. Include the version
(`harborlight --version`), your Ubuntu release, and the steps to reproduce.
