# Development

Everything in this document assumes Ubuntu 22.04, 24.04 or 26.04 and a checkout of the repository.
Read [ARCHITECTURE.md](ARCHITECTURE.md) first if you have not yet — the process boundaries explain
why the code is laid out the way it is.

## Contents

- [Set up](#set-up)
- [Run the app](#run-the-app)
- [Mock mode](#mock-mode)
- [Stop the session](#stop-the-session)
- [Logs](#logs)
- [Tests](#tests)
- [Making a UI change](#making-a-ui-change)
- [Adding a Docker operation](#adding-a-docker-operation-end-to-end)
- [Debugging](#debugging)
- [Environment variables](#environment-variables)
- [Coding standards](#coding-standards)

## Set up

```bash
git clone https://github.com/fmussad/Harborlight.git
cd Harborlight

# Node 20 LTS is pinned in .nvmrc
nvm install && nvm use          # or install Node 20 however you prefer
node --version                  # v20.x

make bootstrap                  # npm install
```

`make bootstrap` prints the Node version it found next to the pinned one, then installs
dependencies. Nothing else is required: no global CLI, no Docker image, no post-install step.

Optional tools:

| Tool                       | Needed for                                                    |
| -------------------------- | ------------------------------------------------------------- |
| Docker Engine + Compose v2 | Working against real containers (`make dev` without `MOCK=1`) |
| `python3` + Pillow         | `make icons` (regenerating icons from the SVG)                |
| `dpkg-deb`, `fakeroot`     | `make package`                                                |
| Trivy                      | Image vulnerability scanning inside the app                   |

## Run the app

```bash
make dev
```

This starts `electron-vite dev` in the background through `scripts/dev.sh`:

- The renderer runs on Vite with hot module replacement. Editing a React component updates the
  window without losing state.
- Main and preload are rebuilt and the Electron process is restarted automatically when you edit
  them. Expect the window to blink; that is the restart.
- The session runs in its own process group (`setsid`) and its PID is written to
  `.harborlight/dev.pid`. Output goes to `.harborlight/dev.log`.
- Running `make dev` twice does nothing the second time — it detects the recorded session, prints
  the PID and exits successfully.

To run it in the foreground instead (useful when you want Ctrl-C and immediate output):

```bash
FOREGROUND=1 scripts/dev.sh
```

## Mock mode

Harborlight ships a complete in-memory engine so you can develop the UI without Docker, on a
machine without permission to reach the socket, or on a plane:

```bash
make dev MOCK=1                 # sets HARBORLIGHT_ENGINE=mock
```

Mock mode provides containers in several states, Compose projects, images, volumes, networks, disk
usage, a synthetic log stream and a fake shell. It is deterministic, so the same fixtures appear
every run — which is exactly what the E2E suite relies on.

You can also switch at runtime in **Settings → Docker Engine → Engine mode**, and back. The sidebar
shows a "Mock engine" badge whenever the mock adapter is active, so demo data can never be mistaken
for a real host.

## Stop the session

```bash
make stop
```

`scripts/stop.sh` reads `.harborlight/dev.pid`, sends `SIGTERM` to that **process group**, waits up
to five seconds, and escalates to `SIGKILL` only if needed. It never runs `pkill electron`, so your
editor (which may itself be Electron) and any other Node processes are untouched. If the PID file is
stale, it says so and cleans up. Running it with nothing started is a no-op.

## Logs

| Source                                       | Where                                            |
| -------------------------------------------- | ------------------------------------------------ |
| Development session (Vite + Electron stdout) | `.harborlight/dev.log` — `make logs` follows it  |
| Application log                              | `~/.config/Harborlight/logs/harborlight.log`     |
| Renderer console                             | DevTools console (`Ctrl+Shift+I` in a dev build) |

Raise the level with `HARBORLIGHT_LOG_LEVEL=debug` (already the default for `make dev`). Levels are
`error`, `warn`, `info` and `debug`. Log lines are tagged by subsystem (`ipc`, `engine`, `compose`,
`security`, `app`), so `grep security` or `grep compose` is usually the fastest triage.

Inside the app, **Settings → About → Export diagnostics** writes a redacted bundle (settings,
engine status, platform info, recent log lines) that is safe to attach to a bug report.

## Tests

```bash
make test           # Vitest: unit + renderer projects
make test-watch     # the same suites in watch mode
make test-e2e       # Playwright driving a real Electron build
make check          # lint + typecheck + test
```

Single files or patterns:

```bash
npx vitest run tests/unit/composeArgs.test.ts
npx vitest run -t "rejects a payload"
npx playwright test tests/e2e/security.spec.ts
npx playwright test --debug          # inspector, needs a display
```

The E2E suite builds the app first (`make test-e2e` depends on `build`) and always launches with the
mock engine and a throwaway `--user-data-dir`, so it never touches your real settings or your real
Docker resources. See [TESTING.md](TESTING.md) for the full map of what is covered.

## Making a UI change

The design system lives in three places:

| Layer      | File                                        | Contains                                                                                           |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Tokens     | `src/renderer/styles/theme.css`             | Colour, radius, shadow and spacing custom properties for both themes.                              |
| Primitives | `src/renderer/components/ui/primitives.tsx` | Button, Card, Badge, Input, Select, Checkbox, Switch, Kbd, Spinner, SegmentedControl, ProgressBar. |
| Overlays   | `src/renderer/components/ui/overlays.tsx`   | Dialog, ConfirmDialog, Drawer, DropdownMenu, Tabs (Radix-based).                                   |

Guidelines that keep the UI coherent:

- **Never hard-code a colour.** Use the semantic tokens (`bg-surface`, `text-muted`,
  `border-subtle`, `text-accent`, …). Both themes are then correct by construction.
- **Reuse primitives** rather than styling a raw `<button>`; focus rings, disabled states and
  keyboard behaviour are already handled there.
- **Every state matters.** A view needs loading, empty, error and engine-disconnected states. The
  existing pages show the pattern; `StatusBits.tsx` has the shared state badges.
- **Keyboard first.** Interactive elements must be reachable by Tab, have a visible focus ring, and
  carry an `aria-label` when the label is an icon.
- Check both themes and both densities before opening a pull request. The reference sheets in
  `docs/images/` are the visual target.

## Adding a Docker operation end to end

The contract is the single source of truth, so work outwards from it. As an example, adding
`containers.export`:

1. **Declare the command and its payload** in `src/shared/contracts/commands.ts`:

   ```ts
   'containers.export': z.object({
     id: z.string().min(1).max(128),
     destination: absolutePathSchema
   }),
   ```

   Adding the key adds it to the allowlist; nothing else is needed to make it callable.

2. **Declare the result type** in `src/shared/contracts/responses.ts`:

   ```ts
   'containers.export': { path: string; bytes: number }
   ```

3. **Extend the engine interface** in `src/main/docker/engine.ts` and implement it in _both_
   adapters — `dockerAdapter.ts` (real behaviour, normalized through `normalize.ts`) and
   `mockAdapter.ts` (deterministic fixture). TypeScript will not compile until both exist, which is
   deliberate: mock mode must never silently lose a feature.

4. **Write the handler** in the matching module under `src/main/ipc/handlers/`. Handlers receive a
   validated payload and the `AppContext`. Use `context.engines.requireConnected()` so a
   disconnected engine produces a friendly error, throw `HarborlightError` with a `code` and a
   `hint` for anything the user can fix, and register long work with `tasks.start()` when it needs
   progress or cancellation.

5. **Wire it into the renderer.** Add a query or mutation in `src/renderer/lib/queries.ts`,
   invalidate the affected query keys on success, and surface failures with `useToast()` — the
   thrown `UiError` already carries `message` and `hint`.

6. **Test it.** A unit test for argument or normalization logic, a renderer test if there is a
   confirmation flow, and an entry in the IPC contract test if the command has interesting
   validation. Destructive operations must be covered by a test that proves the confirmation is
   required.

7. **Document it** in [DOCKER_OPERATIONS.md](DOCKER_OPERATIONS.md) in the same change.

## Debugging

### Main process

`make dev` starts Electron without a debug port. To attach a debugger, run the session in the
foreground with the inspector enabled:

```bash
make stop
npx electron-vite dev --inspect=5858
```

Then open `chrome://inspect` in Chromium, or attach VS Code with:

```jsonc
{ "type": "node", "request": "attach", "name": "Harborlight main", "port": 5858 }
```

Breakpoints in `src/main/**` work directly because electron-vite emits source maps.

### Preload

The preload script runs in the renderer's process but with its own context. Open DevTools and pick
the preload context in the **Sources → top frame** dropdown, or simply log through `console.log` —
preload output appears in the DevTools console, not the terminal.

### Renderer

`Ctrl+Shift+I` opens DevTools in a development build (they are disabled in packaged builds). React
DevTools work as usual. Because the renderer is sandboxed, `require` and `process` are not available
in the console — that is the boundary working, not a bug.

### IPC traffic

Set `HARBORLIGHT_LOG_LEVEL=debug` and watch `make logs`: the gateway logs every command with its
duration, and rejected commands with the reason. Very chatty commands (`containers.list`,
`containers.stats`, `engine.getStatus`, …) are logged at debug level only.

### The engine layer

To see what Docker is actually returning, compare against the same call over the socket:

```bash
curl --unix-socket /var/run/docker.sock http://localhost/v1.44/containers/json | jq '.[0]'
```

If the UI shows something odd, the difference is almost always in `src/main/docker/normalize.ts`,
which is covered by unit tests.

## Environment variables

| Variable                                     | Effect                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `HARBORLIGHT_ENGINE=mock`                    | Force the mock engine regardless of settings.                             |
| `HARBORLIGHT_LOG_LEVEL`                      | `error`, `warn`, `info` (default) or `debug`.                             |
| `HARBORLIGHT_ALLOW_ROOT=1`                   | Allow starting as root (equivalent to `--allow-root`). Not for daily use. |
| `HARBORLIGHT_FORCE_UNSUPPORTED=1`            | Skip the unsupported-distribution dialog.                                 |
| `HARBORLIGHT_GIT_SHA`, `HARBORLIGHT_CHANNEL` | Override build metadata at build time.                                    |
| `HARBORLIGHT_UPDATE_BASE_URL`                | Point update checks at a local release directory.                         |
| `MOCK=1`, `FOREGROUND=1`                     | Consumed by `scripts/dev.sh`.                                             |

Command-line flags: `--version`, `--hidden` / `--start-minimized`, `--allow-root`,
`--force-unsupported`.

## Coding standards

- **TypeScript strict**, no `any` without a comment explaining why it is unavoidable, and no
  `@ts-ignore`. `make typecheck` covers the main, renderer and E2E projects.
- **ESLint with `--max-warnings 0`.** The React Hooks rules are on, including the newer purity and
  set-state-in-effect rules; if one fires, restructure rather than disable.
- **Comments explain intent**, not mechanics. If a line needs a comment to say what it does, the
  line is usually the problem.
- **Errors are never swallowed.** Either handle it, or throw a `HarborlightError` with a code and a
  hint so the UI can be useful.
- **Buffers are always bounded.** Logs, task history and usage samples all have explicit limits.
- Formatting is Prettier (`make format` or `npm run format`); the config is in `.prettierrc.json`.
