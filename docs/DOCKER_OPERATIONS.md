# Docker operations

This is the complete list of what Harborlight does to your Docker installation, and exactly how.
Every row is an IPC command from [the allowlist](../src/shared/contracts/commands.ts), handled in
the main process and executed either through the Docker Engine API (Dockerode over a Unix socket) or
by spawning `docker compose`.

Two rules hold everywhere:

1. **Success is never assumed.** A handler awaits Docker's response before reporting success, so the
   UI cannot show a state the engine did not confirm.
2. **Destructive work is confirmed.** Anything that removes a container, image, volume, network or
   Compose stack goes through a confirmation dialog that names what will be removed, and the
   corresponding command refuses to run without the confirmation flag where data loss is possible.

## Contents

- [Connection and status](#connection-and-status)
- [Containers](#containers)
- [Logs](#logs)
- [Exec / terminal](#exec--terminal)
- [Images](#images)
- [Volumes](#volumes)
- [Networks](#networks)
- [Cleanup](#cleanup)
- [Compose](#compose)
- [Registries](#registries)
- [What Harborlight never does](#what-harborlight-never-does)

## Connection and status

| Command                  | Docker call                            | Notes                                                                                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine.getStatus`       | `GET /version` + `GET /info`           | Version, API version, OS, kernel, architecture, CPU count, memory, container counts. Rootless is inferred from the socket path and `SecurityOptions`.                                                                                                                                       |
| `engine.reconnect`       | disposes the adapter and re-creates it | Used after changing the socket in Settings.                                                                                                                                                                                                                                                 |
| `engine.listSockets`     | filesystem probe                       | Checks `$DOCKER_HOST` (when it is a `unix://` URL), `/run/user/<uid>/docker.sock`, `$XDG_RUNTIME_DIR/docker.sock` and `/var/run/docker.sock`, reporting which exist and are readable. `tcp://`, `http(s)://` and `ssh://` endpoints are rejected: this version only talks to local sockets. |
| `engine.getDiskUsage`    | `GET /system/df`                       | Cached for five minutes because it is expensive on hosts with a large build cache.                                                                                                                                                                                                          |
| `engine.getUsageHistory` | none                                   | Returns the samples `EngineManager` aggregates every 15 seconds from live container stats.                                                                                                                                                                                                  |

Connection failures are mapped to friendly errors: `EACCES` on the socket becomes a `permission`
error with the "add your user to the docker group, or use rootless Docker" hint; `ENOENT` becomes
`engine-unavailable` with instructions to start the service.

## Containers

| Command              | Docker call                                                  | Confirmation                                                   |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `containers.list`    | `GET /containers/json?all=…`                                 | —                                                              |
| `containers.inspect` | `GET /containers/{id}/json`                                  | —                                                              |
| `containers.stats`   | `GET /containers/{id}/stats?stream=false`                    | —                                                              |
| `containers.start`   | `POST /containers/{id}/start`                                | —                                                              |
| `containers.stop`    | `POST /containers/{id}/stop?t=<timeout>`                     | —                                                              |
| `containers.restart` | `POST /containers/{id}/restart?t=<timeout>`                  | —                                                              |
| `containers.pause`   | `POST /containers/{id}/pause`                                | —                                                              |
| `containers.unpause` | `POST /containers/{id}/unpause`                              | —                                                              |
| `containers.kill`    | `POST /containers/{id}/kill?signal=…`                        | yes — sending SIGKILL can corrupt state                        |
| `containers.rename`  | `POST /containers/{id}/rename?name=…`                        | —                                                              |
| `containers.remove`  | `DELETE /containers/{id}?force=…&v=…`                        | yes — and a second warning when `v` (anonymous volumes) is set |
| `containers.run`     | `POST /containers/create` then `POST /containers/{id}/start` | —                                                              |

Details worth knowing:

- **Stats** are a single snapshot (`stream: false`). CPU percentage is computed from the delta
  between `cpu_stats` and `precpu_stats` the way the Docker CLI does it, then normalized by the
  number of host CPUs for the Overview aggregate.
- **Inspect** redacts environment variables that look like secrets (`*_TOKEN`, `*_SECRET`,
  `*PASSWORD*`, `*_KEY`, connection strings with credentials, …) when
  **Settings → Security → Redact environment secrets** is on, which is the default. The redaction
  rules live in `src/shared/utils/redact.ts` and are unit tested.
- **Run** accepts an image reference, an optional name, command, port bindings, environment
  variables, bind mounts and named volumes, a restart policy, `--rm` and detach. The command string
  is tokenized with a POSIX-style tokenizer (`src/main/docker/command.ts`) into an argument array —
  it is never passed to a shell.
- **Timeouts** are bounded by the schema (0–600 s), and signals are restricted to
  `SIGTERM | SIGKILL | SIGINT | SIGHUP`.

## Logs

| Command       | Docker call                                                                        |
| ------------- | ---------------------------------------------------------------------------------- |
| `logs.start`  | `GET /containers/{id}/logs?follow=1&stdout=1&stderr=1&tail=N&timestamps=…&since=…` |
| `logs.stop`   | destroys the stream                                                                |
| `logs.export` | the same request with `follow=0`, written to a file you choose                     |

- Docker multiplexes stdout and stderr into 8-byte-framed chunks when the container has no TTY.
  `LogAssembler` reassembles partial frames across socket reads, so a line is never split and stderr
  is never mixed into stdout.
- Chunks are flushed to the renderer at most every ~90 ms in batches, and at most 5000 pending
  chunks are held; beyond that the oldest are dropped and the viewer says so. The renderer keeps a
  bounded ring buffer as well.
- Search, level filtering and highlighting happen in the renderer over the buffered lines. A regular
  expression that fails to compile is reported inline instead of throwing.
- Stopping a stream is guaranteed: handles live in a registry that is emptied when the window closes
  or the app quits.

## Exec / terminal

| Command       | Docker call                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------- |
| `exec.start`  | `POST /containers/{id}/exec` then `POST /exec/{id}/start` with `Tty: true`, hijacked stream |
| `exec.write`  | writes to the hijacked stream                                                               |
| `exec.resize` | `POST /exec/{id}/resize?h=…&w=…`                                                            |
| `exec.stop`   | closes the stream and removes the session                                                   |

The requested shell is tried first; otherwise the candidates `/bin/bash`, `/bin/sh` and `/bin/ash`
are probed in order with a throwaway `exec` (`<shell> -c 'exit 0'`) so minimal images still open a
usable shell and distroless images fail with a clear message instead of a hang. Sessions are keyed
by a server-generated UUID; the renderer can never address a session it did not open, and every
session is terminated when the window closes or the app quits.

Root inside a container is not root on the host, but it can still write to bind mounts as uid 0, so
the terminal warns before the first keystroke when the session runs as root. Harborlight only ever
runs `docker exec` inside an existing container — there is no way to get a host shell from the UI.

## Images

| Command                   | Docker call                                                                                                          | Confirmation                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `images.list`             | `GET /images/json` + `GET /containers/json?all=1` to mark images in use                                              | —                                        |
| `images.inspect`          | `GET /images/{id}/json`                                                                                              | —                                        |
| `images.history`          | `GET /images/{id}/history`                                                                                           | —                                        |
| `images.pull`             | `POST /images/create?fromImage=…` with progress events                                                               | —                                        |
| `images.remove`           | `DELETE /images/{id}?force=…&noprune=…`                                                                              | yes — lists the tags that will disappear |
| `images.tag`              | `POST /images/{id}/tag?repo=…&tag=…`                                                                                 | —                                        |
| `images.scan`             | `trivy image --quiet --scanners vuln --format json --timeout 5m --image-src docker <reference>` (external, optional) | —                                        |
| `images.scanAvailability` | `trivy --version`                                                                                                    | —                                        |

- Pull registers a cancellable background task. Layer progress from the Docker progress stream is
  aggregated into a single percentage; cancelling aborts the request.
- Pull uses stored registry credentials when the reference matches a configured registry; the
  credentials are decrypted in the main process only for the duration of the call.
- Image references are validated by schema before they are used
  (`registry/name:tag` or `name@sha256:<64 hex>`).
- Scanning is optional and only enabled when Trivy is installed. Harborlight does not download a
  scanner for you.

## Volumes

| Command           | Docker call                                               | Confirmation                          |
| ----------------- | --------------------------------------------------------- | ------------------------------------- |
| `volumes.list`    | `GET /volumes` + container inspection to compute "in use" | —                                     |
| `volumes.inspect` | `GET /volumes/{name}`                                     | —                                     |
| `volumes.remove`  | `DELETE /volumes/{name}?force=…`                          | yes — volume data cannot be recovered |

## Networks

| Command            | Docker call                                                  | Confirmation                                                             |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `networks.list`    | `GET /networks` + container inspection for attachment counts | —                                                                        |
| `networks.inspect` | `GET /networks/{id}`                                         | —                                                                        |
| `networks.remove`  | `DELETE /networks/{id}`                                      | yes; the built-in `bridge`, `host` and `none` networks are never offered |

## Cleanup

Cleanup is a two-step flow. `cleanup.analyze` builds a plan; `cleanup.run` executes only the
categories you selected.

| Category           | Docker call                                              | Selected by default | Dangerous |
| ------------------ | -------------------------------------------------------- | ------------------- | --------- |
| Stopped containers | `POST /containers/prune`                                 | yes                 | no        |
| Dangling images    | `POST /images/prune?filters={"dangling":{"true":true}}`  | yes                 | no        |
| Unused images      | `POST /images/prune?filters={"dangling":{"false":true}}` | yes                 | no        |
| Unused build cache | `POST /build/prune`                                      | yes                 | no        |
| Unused networks    | `POST /networks/prune`                                   | no                  | no        |
| Unused volumes     | `POST /volumes/prune`                                    | no                  | **yes**   |

- The plan lists every item by name with its size, and the headline "reclaimable" figure
  **excludes** volumes, so the primary button can never imply data deletion.
- Volumes are a separate, unchecked, red-flagged category. Selecting them requires an additional
  confirmation.
- `cleanup.run` supports `dryRun: true`, which reports what each category would remove without
  calling any prune endpoint.
- Categories run in a deterministic order — containers first, so their images become removable — and
  a failure in one category is reported without aborting the others.
- Harborlight never calls `docker system prune`, with or without `-a --volumes`.

## Compose

Compose runs through the `docker compose` CLI, because dependency ordering, profiles and build
semantics are not part of the Engine API.

| Command                                 | What runs                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.discover`                      | Lists projects from container labels (`com.docker.compose.project`) plus Compose files found in known project directories. No command is executed. |
| `compose.readFile` / `compose.saveFile` | Reads/writes a validated Compose file path. Saving requires `confirmed: true`.                                                                     |
| `compose.validate`                      | `docker compose --project-name … --file … config`                                                                                                  |
| `compose.preview`                       | Nothing. Returns the exact command line that the action would run.                                                                                 |
| `compose.action`                        | `docker compose --project-name <name> --file <file>… <action> [flags] [services]`                                                                  |
| `compose.cancel`                        | Sends `SIGTERM` to the running child process.                                                                                                      |

Argument construction (`src/main/compose/args.ts`) is pure and exhaustively unit tested:

| Action                       | Arguments                                                         |
| ---------------------------- | ----------------------------------------------------------------- |
| `up`                         | `up [--detach] [--remove-orphans] [services…]`                    |
| `down`                       | `down [--volumes] [--remove-orphans]` (never takes service names) |
| `start` / `stop` / `restart` | `start` / `stop` / `restart` `[services…]`                        |
| `pull`                       | `pull [services…]`                                                |
| `build`                      | `build [--no-cache] [services…]`                                  |
| `rebuild`                    | `up --build --force-recreate [--detach] [services…]`              |

Safety properties:

- **No shell.** `spawn('docker', args, { shell: false })`. Values are never concatenated into a
  command string; the preview shown in the UI is quoted for display only.
- **Paths are validated twice.** The schema requires an absolute path with no `..` and a
  Compose-shaped filename (`compose.yml`, `compose.yaml`, `docker-compose.yml`, `docker-compose.yaml`
  or `*.compose.yml`); `paths.ts` then resolves it and asserts it is inside the working directory.
- **`down` is destructive** and requires `confirmedDestructive: true`; `down --volumes` requires an
  extra confirmation that spells out that volume data will be deleted.
- **Output is streamed** to the renderer as `compose:output` events with the exit code delivered as
  `compose:exit`, so you see what Compose printed, not a summary.
- Long operations are registered as cancellable background tasks.

## Registries

| Command                                              | Effect                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `registry.list` / `registry.add` / `registry.remove` | Registry metadata (name, kind, server address, username) in `~/.config/Harborlight/registries.json`.                       |
| `registry.login`                                     | Encrypts the secret with Electron `safeStorage` and stores the ciphertext, base64-encoded, in the same file (mode `0600`). |
| `registry.logout`                                    | Clears the username and the stored ciphertext.                                                                             |
| `registry.status`                                    | Reports whether encrypted storage is available and which keyring backend is in use.                                        |

The plaintext secret exists only in main-process memory, for the duration of the login call and of
each pull that uses it. It is never returned to the renderer — the renderer only learns
`hasCredentials: true`. If no OS keyring is available, `registry.login` fails with a clear
explanation instead of falling back to plain text. Credentials are proved to work by the first pull
that uses them; Harborlight does not perform a separate login round-trip. See
[SECURITY.md](SECURITY.md#registry-credentials).

## What Harborlight never does

- Never runs `docker system prune`.
- Never removes a resource that you did not select in a dialog that named it.
- Never changes Docker socket ownership or permissions.
- Never runs `docker` through a shell, and never builds a command string from user input.
- Never writes to a Compose file without an explicit save, and never writes outside the project
  directory.
- Never sends any data anywhere: there is no telemetry, no crash reporting and no remote logging.
  The only outbound requests are Docker registry pulls you initiate and, if enabled, an update check
  against the release URL.
