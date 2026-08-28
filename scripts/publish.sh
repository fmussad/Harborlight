#!/usr/bin/env bash
#
# Builds and publishes a Harborlight release.
#
#   VERSION=0.1.0 CHANNEL=stable scripts/publish.sh
#   VERSION=0.1.0 CHANNEL=stable PUBLISH_DRY_RUN=1 scripts/publish.sh
#
# The publication target is behind a small provider interface:
#   PUBLISH_PROVIDER=local   (default) assemble a complete release directory
#   PUBLISH_PROVIDER=github  upload that directory to a GitHub release
#
# Nothing is committed, tagged or pushed unless PUBLISH_TAG=1 is set.
#
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

VERSION="${VERSION:-}"
CHANNEL="${CHANNEL:-stable}"
PROVIDER="${PUBLISH_PROVIDER:-local}"
DRY_RUN="${PUBLISH_DRY_RUN:-0}"
TAG_RELEASE="${PUBLISH_TAG:-0}"
SKIP_CHECKS="${PUBLISH_SKIP_CHECKS:-0}"
RELEASE_ROOT="${PUBLISH_DIR:-${ROOT}/release}"

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""
fi

info() { printf '%s %s\n' "${C_BLUE}==>${C_RESET}" "$*"; }
ok()   { printf '%s %s\n' "${C_GREEN}  ok${C_RESET}" "$*"; }
warn() { printf '%s %s\n' "${C_YELLOW}warn${C_RESET}" "$*" >&2; }
die()  { printf '%s %s\n' "${C_RED}error${C_RESET}" "$*" >&2; exit 1; }

step() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '%s would run: %s\n' "${C_YELLOW}dry-run${C_RESET}" "$*"
    return 0
  fi
  "$@"
}

# ------------------------------------------------------------------ preflight

[[ -n "${VERSION}" ]] || die "VERSION is required. Example: make publish VERSION=0.1.0 CHANNEL=stable"

[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] ||
  die "VERSION '${VERSION}' is not a semantic version (1.2.3 or 1.2.3-beta.1)."

[[ "${CHANNEL}" =~ ^(stable|beta)$ ]] || die "CHANNEL must be stable or beta."

if [[ "${CHANNEL}" == "stable" ]] && [[ "${VERSION}" == *-* ]]; then
  die "A prerelease version (${VERSION}) cannot be published to the stable channel."
fi
if [[ "${CHANNEL}" == "beta" ]] && [[ "${VERSION}" != *-* ]]; then
  warn "Publishing a non-prerelease version to the beta channel."
fi

command -v git >/dev/null 2>&1 || die "git is required."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a Git repository."

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  die "The working tree is dirty. Commit or stash your changes before publishing."
fi

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
if [[ "${PACKAGE_VERSION}" != "${VERSION}" ]]; then
  die "package.json is at ${PACKAGE_VERSION} but VERSION=${VERSION}. Update package.json and commit it first."
fi

GIT_SHA="$(git rev-parse HEAD)"
GIT_SHORT="$(git rev-parse --short=12 HEAD)"
RELEASED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RELEASE_DIR="${RELEASE_ROOT}/${CHANNEL}/${VERSION}"

info "Publishing ${C_BOLD}Harborlight ${VERSION}${C_RESET} (${CHANNEL}) from ${GIT_SHORT}"
printf '    provider   %s\n' "${PROVIDER}"
printf '    output     %s\n' "${RELEASE_DIR}"
printf '    tag+push   %s\n' "$([[ "${TAG_RELEASE}" == "1" ]] && echo yes || echo 'no (set PUBLISH_TAG=1)')"
[[ "${DRY_RUN}" == "1" ]] && printf '    %sdry run: no artifacts are uploaded%s\n' "${C_YELLOW}" "${C_RESET}"
printf '\n'

# ---------------------------------------------------------------- build gates

if [[ "${SKIP_CHECKS}" == "1" ]]; then
  warn "PUBLISH_SKIP_CHECKS=1: skipping lint, typecheck and tests."
else
  info "Linting"
  npm run --silent lint
  info "Type checking"
  npm run --silent typecheck
  info "Running unit tests"
  npm run --silent test
  ok "All checks passed."
fi

info "Building packages (.deb and AppImage)"
if [[ "${DRY_RUN}" == "1" ]]; then
  printf '%s would run: npm run package\n' "${C_YELLOW}dry-run${C_RESET}"
  if ! compgen -G "dist/*.deb" >/dev/null; then
    warn "No artifacts in dist/. The dry run will describe an empty release."
  fi
else
  UPDATE_CHANNEL="${CHANNEL}" npm run --silent package
fi

# ------------------------------------------------------------------- assemble

info "Assembling ${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

shopt -s nullglob
artifacts=(dist/*.deb dist/*.AppImage)
shopt -u nullglob

if [[ ${#artifacts[@]} -eq 0 ]] && [[ "${DRY_RUN}" != "1" ]]; then
  die "No .deb or .AppImage found in dist/. Packaging did not produce artifacts."
fi

for artifact in "${artifacts[@]}"; do
  cp -f "${artifact}" "${RELEASE_DIR}/"
done

# install.sh is part of the release so users can install without a checkout.
cp -f "${ROOT}/install.sh" "${RELEASE_DIR}/install.sh"
chmod +x "${RELEASE_DIR}/install.sh"

info "Generating checksums.sha256"
(
  cd "${RELEASE_DIR}"
  : >checksums.sha256
  for file in *.deb *.AppImage install.sh; do
    [[ -e "${file}" ]] || continue
    sha256sum "${file}" >>checksums.sha256
  done
)
ok "$(wc -l <"${RELEASE_DIR}/checksums.sha256" | tr -d ' ') entries"

# --------------------------------------------------------------- manifests

BASE_URL="${PUBLISH_BASE_URL:-https://github.com/fmussad/Harborlight/releases/download/v${VERSION}}"
RELEASE_URL="${PUBLISH_RELEASE_URL:-https://github.com/fmussad/Harborlight/releases/tag/v${VERSION}}"

info "Writing release manifests"
VERSION="${VERSION}" CHANNEL="${CHANNEL}" GIT_SHA="${GIT_SHA}" RELEASED_AT="${RELEASED_AT}" \
BASE_URL="${BASE_URL}" RELEASE_URL="${RELEASE_URL}" RELEASE_DIR="${RELEASE_DIR}" \
node "${ROOT}/scripts/write-manifest.mjs"

# The channel pointer lives next to the versioned directories.
cp -f "${RELEASE_DIR}/release.json" "${RELEASE_ROOT}/${CHANNEL}/latest.json"
ok "${RELEASE_ROOT#"${ROOT}/"}/${CHANNEL}/latest.json -> ${VERSION}"

# ---------------------------------------------------------------- verify

info "Verifying the assembled release"
(
  cd "${RELEASE_DIR}"
  sha256sum --check --quiet checksums.sha256
) || die "Checksum verification failed in ${RELEASE_DIR}."

node -e "
  const fs = require('node:fs')
  const manifest = JSON.parse(fs.readFileSync('${RELEASE_DIR}/release.json', 'utf8'))
  const missing = manifest.artifacts.filter((a) => !fs.existsSync('${RELEASE_DIR}/' + a.name))
  if (missing.length > 0) {
    console.error('Manifest references missing files: ' + missing.map((a) => a.name).join(', '))
    process.exit(1)
  }
  if (manifest.version !== '${VERSION}' || manifest.channel !== '${CHANNEL}') {
    console.error('Manifest version/channel mismatch.')
    process.exit(1)
  }
" || die "Manifest verification failed."
ok "Checksums and manifest agree."

# --------------------------------------------------------------- providers

publish_local() {
  info "Provider: local"
  ok "Release directory ready: ${RELEASE_DIR}"
  printf '\n'
  printf '  Serve it for testing:\n'
  printf '    python3 -m http.server --directory %s 8099\n' "${RELEASE_ROOT}"
  printf '    HARBORLIGHT_UPDATE_BASE_URL=http://localhost:8099 harborlight\n'
  printf '\n'
  printf '  Install from it:\n'
  printf '    ./install.sh install --artifact %s/harborlight_%s_amd64.deb\n' "${RELEASE_DIR}" "${VERSION}"
  printf '\n'
}

publish_github() {
  info "Provider: github"
  command -v gh >/dev/null 2>&1 ||
    die "The GitHub CLI (gh) is required for PUBLISH_PROVIDER=github. Install it and run 'gh auth login', or use PUBLISH_PROVIDER=local."
  gh auth status >/dev/null 2>&1 ||
    die "gh is not authenticated. Run 'gh auth login' first."

  local tag="v${VERSION}"
  local notes="Harborlight ${VERSION} (${CHANNEL})

Commit: ${GIT_SHA}
Built:  ${RELEASED_AT}

Install:
    ./install.sh install --source release --channel ${CHANNEL} --version ${VERSION}

Verify downloads against checksums.sha256."

  if [[ "${TAG_RELEASE}" != "1" ]]; then
    die "Creating a GitHub release requires the tag ${tag}. Re-run with PUBLISH_TAG=1 to create and push it, or create it yourself first."
  fi

  if git rev-parse "${tag}" >/dev/null 2>&1; then
    ok "Tag ${tag} already exists."
  else
    step git tag -a "${tag}" -m "Harborlight ${VERSION}"
    step git push origin "${tag}"
  fi

  if gh release view "${tag}" >/dev/null 2>&1; then
    step gh release upload "${tag}" "${RELEASE_DIR}"/* --clobber
  else
    step gh release create "${tag}" "${RELEASE_DIR}"/* \
      --title "Harborlight ${VERSION}" \
      --notes "${notes}" \
      $([[ "${CHANNEL}" == "beta" ]] && printf -- '--prerelease')
  fi

  if [[ "${DRY_RUN}" != "1" ]]; then
    gh release view "${tag}" --json assets --jq '.assets[].name' ||
      die "Could not verify the published release assets."
  fi
  ok "Published ${tag}."
}

case "${PROVIDER}" in
  local) publish_local ;;
  github) publish_github ;;
  *) die "Unknown PUBLISH_PROVIDER '${PROVIDER}'. Supported: local, github." ;;
esac

printf '%s%sRelease %s (%s) is ready.%s\n' "${C_GREEN}" "${C_BOLD}" "${VERSION}" "${CHANNEL}" "${C_RESET}"
[[ "${DRY_RUN}" == "1" ]] && printf '%sThis was a dry run.%s\n' "${C_YELLOW}" "${C_RESET}"
exit 0
