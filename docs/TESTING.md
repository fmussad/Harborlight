# Testing

Harborlight talks to the Docker socket, so a test suite that is careless is worse than no test suite
at all. The rule that shapes everything below is simple: **no test may ever reach a real Docker
daemon, modify the machine it runs on, or touch your settings.** Every suite is isolated by
construction, not by convention.

## Contents

- [Running the tests](#running-the-tests)
- [The three suites](#the-three-suites)
- [Unit tests](#unit-tests)
- [Renderer tests](#renderer-tests)
- [End-to-end tests](#end-to-end-tests)
- [Isolation guarantees](#isolation-guarantees)
- [Writing a test](#writing-a-test)
- [Determinism](#determinism)
- [Coverage](#coverage)
- [Before opening a pull request](#before-opening-a-pull-request)
- [What is deliberately not tested](#what-is-deliberately-not-tested)

## Running the tests

```bash
make test           # Vitest: the unit and renderer projects
make test-watch     # the same suites, watching for changes
make test-e2e       # builds the app, then drives it with Playwright
make check          # lint + typecheck + test — what CI runs
```

Narrower runs while you work:

```bash
npx vitest run tests/unit/composeArgs.test.ts     # one file
npx vitest run --project unit                     # one project
npx vitest run -t "confirmation"                  # by test name
npx playwright test tests/e2e/security.spec.ts    # one E2E spec
npx playwright test --debug                       # inspector; needs a display
```

`make test-e2e` depends on `build`, so it always runs against freshly compiled output in `out/`. If
you run `npx playwright test` directly, build first (`make build`) or you will test stale code.

## The three suites

| Suite    | Runner                      | Environment         | Speed | Answers                                                         |
| -------- | --------------------------- | ------------------- | ----- | --------------------------------------------------------------- |
| Unit     | Vitest (`unit` project)     | Node                | ~2 s  | Is the logic correct in isolation?                              |
| Renderer | Vitest (`renderer` project) | jsdom               | ~5 s  | Does the UI do the right thing when a user clicks?              |
| E2E      | Playwright                  | Real Electron build | ~30 s | Does the packaged app actually work, and is the sandbox intact? |

The split is configured in `vitest.config.ts` (two projects sharing the `@`, `@shared` and `@main`
aliases) and `playwright.config.ts`.

## Unit tests

`tests/unit/**` runs in Node with no DOM and no Electron. Anything that needs `electron` at runtime
is out of scope here — that is what the E2E suite is for.

| File                   | What it protects                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format.test.ts`       | Byte, percentage, duration, relative-time and port formatting, including the awkward boundaries.                                                  |
| `redact.test.ts`       | Secrets never reach a log, an export or the UI: key matching, deep redaction, token-shaped values.                                                |
| `normalize.test.ts`    | Docker's raw JSON becomes the domain model: states, health, ports, CPU/memory percentages.                                                        |
| `logFrames.test.ts`    | The multiplexed log stream is de-framed correctly, including chunks split mid-header.                                                             |
| `command.test.ts`      | Command tokenizing for the container run dialog — quoting rules, no shell involved.                                                               |
| `composeArgs.test.ts`  | The exact `docker compose` argument vectors, and which actions count as destructive.                                                              |
| `composeParse.test.ts` | Compose YAML parsing, service extraction and the lint warnings shown in the editor.                                                               |
| `composePaths.test.ts` | Path safety: absolute paths only, no traversal, only Compose file names, nothing outside the working directory.                                   |
| `ipcContract.test.ts`  | The IPC allowlist and every payload schema: unknown commands, prototype keys, oversized ids, impossible ports, injection-shaped image references. |
| `osRelease.test.ts`    | `/etc/os-release` parsing and the supported-distribution decision.                                                                                |
| `settings.test.ts`     | Settings defaults, persistence across restarts, `0600` file mode, validation, and recovery from a corrupt file.                                   |
| `autostart.test.ts`    | The autostart desktop entry, byte-identical to the one `install.sh` writes.                                                                       |
| `execSession.test.ts`  | The terminal session lifecycle against the mock engine: start, echo, write, resize, exit, and stale-session errors.                               |
| `installer.test.ts`    | `install.sh` itself — syntax, argument validation, exit codes and the dry-run plan.                                                               |
| `devSession.test.ts`   | `scripts/dev.sh` and `scripts/stop.sh` PID handling.                                                                                              |

Two of these run real shell scripts, which deserves an explanation:

- **`installer.test.ts`** invokes `install.sh` with `--dry-run`, plus `doctor`, `help` and `version`,
  which are read-only commands. Nothing else is ever executed, so the installer's documented
  behaviour cannot drift from [INSTALLATION.md](INSTALLATION.md) without a red test.
- **`devSession.test.ts`** copies `dev.sh` and `stop.sh` into a temporary directory (the scripts
  resolve their root from their own location) and points them at throwaway PID files. The processes
  it signals are `sleep` processes it started itself, in their own session — the test proves
  `stop.sh` stops the recorded process group and leaves every bystander alone.

## Renderer tests

`tests/renderer/**` renders real components into jsdom with React Testing Library and drives them
with `@testing-library/user-event`. Components are never mocked; only the IPC transport is.

| File                        | What it protects                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifyLine.test.ts`      | Log level detection used for colouring and filtering.                                                                                             |
| `DataTable.test.tsx`        | Sorting, grouping and selection in the shared table.                                                                                              |
| `useLogStream.test.tsx`     | Stream subscription, buffering, the bounded backlog, pause and error handling.                                                                    |
| `ContainerActions.test.tsx` | Which actions are enabled per state, which ones confirm, and that a data-losing action confirms even when confirmations are switched off.         |
| `ContainersPage.test.tsx`   | Listing, grouping by stack, search, status and stack filters, and the three empty states (no containers, filters too narrow, engine unreachable). |
| `CleanupCard.test.tsx`      | Only safe waste is preselected, data-destroying categories are opt-in, and the plan is shown before anything runs.                                |
| `CommandPalette.test.tsx`   | Ctrl+K, search across names and images, arrow-key selection, Enter, theme toggling — and that no removal is ever reachable from the palette.      |

The shared helpers live in `tests/renderer/testUtils.tsx`:

```tsx
const transport = installFakeTransport({
  'settings.get': async () => TEST_SETTINGS,
  'containers.list': async () => mockContainers(),
  'containers.stop': async () => ({ ok: true, message: 'stopped' })
})

const { user } = renderWithProviders(<ContainersPage />)
await user.click(screen.getByRole('button', { name: 'Stop' }))
expect(transport.calls).toContainEqual({ command: 'containers.stop', payload: { id: 'aaa' } })
```

- `installFakeTransport` replaces the preload bridge. **A command with no handler throws**, so a test
  can never pass because a call silently returned `undefined`.
- `transport.calls` records every command and payload, which is how "did it actually ask Docker?" is
  asserted.
- `transport.emit(...)` pushes a main-process event (`logs:data`, `engine:status`, …) into the app.
- `TEST_SETTINGS` and `TEST_ENGINE_STATUS` are the shipped defaults, so each test states only what it
  changes.
- `renderWithProviders` wraps the component in a fresh `QueryClient` (no retries, no cache carried
  between tests) and the toast provider, and returns a `user` already set up.
- `resetUiStore()` in `beforeEach`/`afterEach` clears the Zustand store between tests.

Query components by role and accessible name (`getByRole('button', { name: 'Stop' })`). It keeps the
tests readable and doubles as an accessibility check: if a control cannot be found by its name, a
screen-reader user cannot find it either.

## End-to-end tests

`tests/e2e/**` launches the built application with Playwright's Electron support. Three specs:

**`app.spec.ts`** — the app opens a single window with all eight sections, reports the engine as
connected, navigates, lists and filters containers, opens the detail panel, confirms before a
destructive action, and persists a theme change through a real `settings.get` round trip.

**`startup.spec.ts`** — everything that happens before the app appears. A pristine profile is shown
the MIT licence and nothing else; accepting records it and opens the app, declining quits without
writing anything. A profile that has already accepted goes straight to the splash, whose bar reaches
the end before it hands over and closes. A second launch against a running instance exits and leaves
the one window it found, with no extra splash.

The shared fixture marks its temporary profile as having accepted the licence, since the gate is a
one-off dialog and unrelated tests should not have to click through it. Because the splash owns the
screen first, `firstWindow()` is no longer the window a test wants; `windowFor(app, page)` picks a
window by the file it loaded.

**`security.spec.ts`** — the guarantees from [SECURITY.md](SECURITY.md), asserted against the running
app rather than the source:

- `contextIsolation`, `sandbox` and `webSecurity` are on and `nodeIntegration` is off.
- `require`, `process`, `module` and `electron` are all `undefined` in the renderer.
- The bridge exposes exactly `invoke`, `subscribe` and `version` — nothing else.
- The window is served from `file://` under a CSP with `default-src 'none'` and no `unsafe-eval`, and
  an injected inline script does not run.
- An unknown command is rejected with `not-allowed`, and a bad payload with `validation`.
- Error codes and hints survive the bridge instead of collapsing into a generic `Error`.
- A non-allowlisted external URL is refused, and camera permission is denied.

These are the tests to run when you touch anything in `src/main/windows/`, `src/preload/` or the IPC
gateway.

## Isolation guarantees

| Risk                                | How it is prevented                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touching real containers            | Unit and renderer tests never construct `DockerEngineAdapter`; the E2E app is launched with `HARBORLIGHT_ENGINE=mock`.                                |
| Overwriting your settings           | Every test that persists settings uses `mkdtemp`; the E2E app runs with `--user-data-dir` pointing at a temporary profile that is deleted afterwards. |
| Installing or uninstalling anything | `installer.test.ts` only runs `--dry-run`, `doctor`, `help` and `version`, with `HOME` redirected to a temporary directory.                           |
| Killing your editor                 | `devSession.test.ts` signals only PIDs it created, in their own session, and asserts that a bystander survives.                                       |
| Noise in the output                 | The `unit` project sets `HARBORLIGHT_QUIET=1`, so the main-process logger stays silent.                                                               |
| Interference between tests          | `resetUiStore()`, a fresh `QueryClient` per render, `setTransport(null)` in the global teardown, and `workers: 1` for Playwright.                     |

## Writing a test

Pick the cheapest suite that can prove the behaviour: a pure function is a unit test, a confirmation
dialog is a renderer test, and the sandbox is an E2E test.

Then:

1. **Name the behaviour, not the function.** `it('asks before killing and names the container')`
   reads like a requirement; `it('handles kill')` does not.
2. **Assert the observable outcome.** For destructive work that means the IPC call was made — or
   provably was not. Rendering without crashing is not an assertion.
3. **Cover the unhappy path.** Disconnected engine, empty list, denied permission, invalid input.
   Most Harborlight bugs live there, which is why every page test has empty and error cases.
4. **Any new destructive operation needs a test proving it confirms first.** This is a review
   requirement, not a suggestion — see [CONTRIBUTING.md](../CONTRIBUTING.md).
5. **Use the fixtures.** `src/shared/mock/fixtures.ts` feeds the mock engine, the demo mode and the
   tests, so a fixture change is visible everywhere at once.

## Determinism

A flaky test is treated as a failing test.

- **Never assert on wall-clock time.** Fixtures use fixed timestamps; formatting helpers take the
  reference time as an argument.
- **Prefer `findBy*` and `waitFor` over timeouts.** There is no `sleep` in the suite except where a
  script under test genuinely needs the process table to settle.
- **Do not depend on test order.** Each test sets up its own transport and resets the store.
- **Avoid PID and process assumptions** beyond what `devSession.test.ts` creates itself.

If a test fails only sometimes, fix the race or delete the test. Do not add a retry.

## Coverage

```bash
npx vitest run --coverage        # v8 provider, HTML + text report in coverage/
```

There is no enforced percentage gate, because a number would reward testing the easy code. The
expectation is qualitative and reviewed by hand:

- Everything under `src/shared/**` (contracts, schemas, utilities) is covered.
- Everything that can destroy data has a test asserting the confirmation.
- Everything that parses external input — Docker JSON, Compose YAML, `/etc/os-release`, log frames,
  IPC payloads — has tests for the malformed cases too.
- The Docker adapter's transport code is exercised through the mock engine and E2E rather than by
  mocking Dockerode, which would only test the mock.

## Before opening a pull request

```bash
make check          # lint, typecheck, unit + renderer
make test-e2e       # if you touched main, preload, packaging or the shell
```

CI runs the same commands. `make check` must be clean — ESLint runs with `--max-warnings 0`, and
`typecheck` covers the main, renderer and E2E TypeScript projects separately.

## What is deliberately not tested

Being explicit about the gaps is more useful than pretending they do not exist:

- **The real Docker adapter against a real daemon.** There is no Docker-in-Docker test environment;
  `DockerEngineAdapter` is verified by hand against Docker Engine on Ubuntu 22.04, 24.04 and 26.04
  before a release. The normalization layer it feeds _is_ unit tested.
- **`.deb` and AppImage installation on a real desktop.** `make package` is verified manually per the
  checklist in [PUBLISHING.md](PUBLISHING.md); only the installer's argument handling and dry-run
  plan are automated.
- **Trivy scanning.** It requires the Trivy binary and a network connection; the UI states around it
  (missing binary, no findings, findings by severity) are covered through the mock engine.
- **Real registry authentication.** Credentials are handled by Electron `safeStorage`, which needs a
  desktop keyring; the code paths around it are exercised, the keyring itself is not.
- **Visual regression.** Both themes are checked by eye against the reference sheets in
  `docs/images/`. There is no screenshot comparison, because the churn would exceed the value.
