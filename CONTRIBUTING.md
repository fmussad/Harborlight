# Contributing

Thanks for helping with Harborlight. This document covers the workflow and the expectations;
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the mechanics of running and debugging the app.

## Before you start

- **Bugs**: open an issue with `harborlight --version`, your Ubuntu release, `./install.sh doctor`
  output and steps to reproduce.
- **Security problems**: do not open a public issue. Follow
  [docs/SECURITY.md](docs/SECURITY.md#reporting-a-vulnerability).
- **Features**: open an issue describing the problem before writing code. Anything that adds a new
  IPC command, changes the security boundary or adds a runtime dependency should be agreed first.

## Setting up

```bash
git clone https://github.com/fmussad/Harborlight.git
cd Harborlight
make bootstrap
make dev          # or: make dev MOCK=1 if you have no Docker here
```

Node 20 LTS (see `.nvmrc`) and npm 10+ are required.

## The workflow

```bash
git switch -c fix/log-follow-jitter

# … change code, add tests, update docs …

make check        # lint + typecheck + test — must pass before you push
make test-e2e     # if you touched the shell, IPC or security boundary
```

Keep pull requests focused: one problem per branch. A 200-line change that does one thing is easier
to review and safer to revert than a 2000-line change that does five.

## What every change should include

| Change                       | Also needs                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New IPC command              | Schema in `commands.ts`, result type in `responses.ts`, both engine adapters, handler, renderer wiring, unit test, a row in [docs/DOCKER_OPERATIONS.md](docs/DOCKER_OPERATIONS.md) |
| New destructive operation    | A confirmation that names the affected resources, a test proving the confirmation is required, a row in [docs/SECURITY.md](docs/SECURITY.md#destructive-action-safeguards)         |
| UI change                    | Both themes checked, keyboard reachable with a visible focus ring, loading/empty/error/disconnected states handled                                                                 |
| Installer or Makefile change | [docs/INSTALLATION.md](docs/INSTALLATION.md) updated, `--dry-run` still accurate                                                                                                   |
| Behaviour change of any kind | The Markdown file that documents it, in the same commit                                                                                                                            |

Documentation is not a follow-up task. If a change makes a document wrong, the change is incomplete.

## Coding standards

- **TypeScript strict.** No `@ts-ignore`. No `any` unless it is unavoidable at an external boundary,
  and then with a comment saying why (see the Dockerode and Trivy adapters for the pattern).
- **ESLint clean.** `make lint` runs with `--max-warnings 0`. The React Hooks rules, including the
  purity and set-state-in-effect rules, are on; restructure rather than disable.
- **Errors are structured.** Throw `HarborlightError` with a `code` and, when the user can fix it, a
  `hint`. Never swallow an error, and never log a secret.
- **Buffers are bounded.** Anything that accumulates — logs, tasks, samples — needs an explicit
  limit.
- **No shell strings.** External programs are spawned with an argument array and `shell: false`.
- **Comments explain why.** The code already says what it does. Do not add comments that narrate it,
  and do not describe the change you are making — that belongs in the commit message.
- **Prettier** formats everything: `make format`.

## Tests

`make test` must pass, and new behaviour needs a test. Choose the cheapest level that actually
proves the behaviour:

| Level            | Use it for                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `tests/unit`     | Pure logic: normalization, argument building, path validation, redaction, parsing, schemas.                  |
| `tests/renderer` | Component behaviour: confirmations, filters, tables, hooks. Use the fake transport, never a real IPC bridge. |
| `tests/e2e`      | Whole-app behaviour: navigation, the security boundary, the IPC contract in a real Electron process.         |

Tests must never touch real Docker resources. The E2E suite runs with the mock engine and a
throwaway user-data directory. See [docs/TESTING.md](docs/TESTING.md).

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```text
feat(containers): add a bulk restart action
fix(logs): keep follow enabled after a container restart
docs(security): document the confirmation rules
refactor(engine): move normalization out of the adapter
test(compose): cover profile arguments
chore(deps): bump electron to 41.7.1
```

Explain _why_ in the body when it is not obvious. Reference the issue.

A pull request should say what changed, why, how you verified it (commands you ran, what you saw),
and call out anything you could not verify in your environment. Screenshots for UI changes, in both
themes.

## Reviewing

Reviewers look for, roughly in this order:

1. Does it cross the security boundary correctly? (allowlist, validation, no shell strings, no
   renderer privilege)
2. Is destructive behaviour confirmed and reversible where possible?
3. Are errors actionable, and are states (loading, empty, error, disconnected) handled?
4. Is it tested at the right level?
5. Are the docs updated?
6. Style and naming, last.

## Releasing

Maintainers only; see [docs/PUBLISHING.md](docs/PUBLISHING.md). In short: bump `package.json`,
update [docs/RELEASES.md](docs/RELEASES.md), `make publish VERSION=… CHANNEL=… PUBLISH_DRY_RUN=1`,
then the real run.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
