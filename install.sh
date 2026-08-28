#!/usr/bin/env bash
#
# Harborlight installer for Ubuntu.
#
#   ./install.sh install [options]
#   ./install.sh upgrade [options]
#   ./install.sh uninstall [--purge]
#   ./install.sh doctor
#   ./install.sh version
#   ./install.sh help
#
# Design rules this script follows:
#   * Print the full plan before touching the system, and honour --dry-run.
#   * Ask before anything privileged or security-sensitive, unless --yes.
#   * Never run the desktop app as root, and never `curl | bash`.
#   * Never change Docker socket permissions behind the user's back.
#   * Keep user configuration on uninstall unless --purge is given.
#
set -Eeuo pipefail

# ------------------------------------------------------------------ constants

readonly SCRIPT_NAME="${0##*/}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly APP_NAME="Harborlight"
readonly APP_ID="harborlight"
readonly DEFAULT_INSTALL_DIR="/opt/${APP_ID}"
readonly DEFAULT_BIN_DIR="/usr/local/bin"
readonly DESKTOP_FILE_NAME="${APP_ID}.desktop"
readonly SUPPORTED_UBUNTU=("22.04" "24.04" "26.04")
readonly DEFAULT_RELEASE_BASE="https://github.com/fmussad/Harborlight/releases/latest/download"

# Exit codes, documented in docs/INSTALLATION.md.
readonly EX_OK=0
readonly EX_USAGE=2
readonly EX_UNSUPPORTED=3
readonly EX_MISSING_DEP=4
readonly EX_ARTIFACT=5
readonly EX_PRIVILEGE=6
readonly EX_VERIFY=7
readonly EX_ABORTED=8

# ------------------------------------------------------------------- defaults

COMMAND=""
SOURCE="local"
ARTIFACT=""
REQUESTED_VERSION=""
CHANNEL="stable"
INSTALL_DIR="${DEFAULT_INSTALL_DIR}"
BIN_DIR="${DEFAULT_BIN_DIR}"
TARGET_USER=""
DESKTOP_ENTRY=1
AUTOSTART=0
START_MINIMIZED=0
LAUNCH=0
DOCKER_MODE="existing"
COMPOSE_MODE="existing"
ADD_USER_TO_DOCKER_GROUP=0
ROOTLESS=0
SOCKET=""
ASSUME_YES=0
DRY_RUN=0
VERBOSE=0
FORCE_UNSUPPORTED=0
PURGE=0
RELEASE_BASE_URL="${HARBORLIGHT_RELEASE_BASE_URL:-${DEFAULT_RELEASE_BASE}}"

LOG_FILE=""
ROLLBACK_ACTIONS=()
INSTALL_STARTED=0

# --------------------------------------------------------------------- output

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log_to_file() {
  [[ -n "${LOG_FILE}" ]] || return 0
  printf '%s %s\n' "$(date -Is)" "$*" >>"${LOG_FILE}" 2>/dev/null || true
}

say()   { printf '%s\n' "$*"; log_to_file "$*"; }
info()  { printf '%s\n' "${C_BLUE}==>${C_RESET} $*"; log_to_file "INFO  $*"; }
ok()    { printf '%s\n' "${C_GREEN}  ok${C_RESET} $*"; log_to_file "OK    $*"; }
warn()  { printf '%s\n' "${C_YELLOW}warn${C_RESET} $*" >&2; log_to_file "WARN  $*"; }
err()   { printf '%s\n' "${C_RED}error${C_RESET} $*" >&2; log_to_file "ERROR $*"; }
debug() { [[ ${VERBOSE} -eq 1 ]] || return 0; printf '%s\n' "${C_DIM}  ..${C_RESET} $*"; log_to_file "DEBUG $*"; }

die() {
  local code="$1"; shift
  err "$*"
  exit "${code}"
}

on_error() {
  local code=$?
  local line=${1:-?}
  err "Failed at line ${line} (exit ${code})."
  if [[ ${INSTALL_STARTED} -eq 1 ]] && [[ ${#ROLLBACK_ACTIONS[@]} -gt 0 ]]; then
    warn "Rolling back partial installation…"
    rollback
  fi
  [[ -n "${LOG_FILE}" ]] && say "Installation log: ${LOG_FILE}"
  exit "${code}"
}
trap 'on_error ${LINENO}' ERR

rollback() {
  local index
  for ((index = ${#ROLLBACK_ACTIONS[@]} - 1; index >= 0; index--)); do
    debug "rollback: ${ROLLBACK_ACTIONS[index]}"
    eval "${ROLLBACK_ACTIONS[index]}" || true
  done
  ROLLBACK_ACTIONS=()
}

add_rollback() { ROLLBACK_ACTIONS+=("$1"); }

# ------------------------------------------------------------------ execution

# Runs a command, or prints it when --dry-run is active.
run() {
  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '%s %s\n' "${C_DIM}dry-run${C_RESET}" "$*"
    log_to_file "DRYRUN $*"
    return 0
  fi
  debug "run: $*"
  log_to_file "RUN   $*"
  "$@"
}

# Same as run(), but through sudo when the script is not already root.
run_priv() {
  if [[ ${EUID} -eq 0 ]]; then
    run "$@"
  else
    run sudo "$@"
  fi
}

confirm() {
  local prompt="$1"
  [[ ${ASSUME_YES} -eq 1 ]] && return 0
  [[ ${DRY_RUN} -eq 1 ]] && return 0
  if [[ ! -t 0 ]]; then
    die ${EX_ABORTED} "${prompt} (no terminal available; re-run with --yes to accept non-interactively)"
  fi
  local answer=""
  read -r -p "${prompt} [y/N] " answer || true
  [[ "${answer}" =~ ^[Yy]([Ee][Ss])?$ ]]
}

have() { command -v "$1" >/dev/null 2>&1; }

# --------------------------------------------------------------------- checks

detect_target_user() {
  if [[ -n "${TARGET_USER}" ]]; then
    id "${TARGET_USER}" >/dev/null 2>&1 ||
      die ${EX_USAGE} "User '${TARGET_USER}' does not exist."
    return
  fi
  if [[ ${EUID} -eq 0 ]] && [[ -n "${SUDO_USER:-}" ]] && [[ "${SUDO_USER}" != "root" ]]; then
    TARGET_USER="${SUDO_USER}"
  elif [[ ${EUID} -eq 0 ]]; then
    TARGET_USER="root"
  else
    TARGET_USER="$(id -un)"
  fi
}

target_home() {
  getent passwd "${TARGET_USER}" | cut -d: -f6
}

os_release_value() {
  local key="$1"
  [[ -r /etc/os-release ]] || return 0
  # shellcheck disable=SC1091
  (. /etc/os-release && printf '%s' "${!key:-}")
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) printf 'unsupported' ;;
  esac
}

check_platform() {
  local id version arch
  id="$(os_release_value ID)"
  version="$(os_release_value VERSION_ID)"
  arch="$(detect_arch)"

  if [[ "${arch}" == "unsupported" ]]; then
    die ${EX_UNSUPPORTED} "Unsupported architecture: $(uname -m). Harborlight ships x86_64 and arm64 builds."
  fi

  local supported=0
  if [[ "${id}" == "ubuntu" ]]; then
    local candidate
    for candidate in "${SUPPORTED_UBUNTU[@]}"; do
      [[ "${version}" == "${candidate}" ]] && supported=1
    done
  fi

  if [[ ${supported} -eq 0 ]]; then
    local detected="${id:-unknown} ${version:-?}"
    if [[ ${FORCE_UNSUPPORTED} -eq 1 ]]; then
      warn "Unsupported system (${detected}); continuing because --force-unsupported was given."
    else
      err "Harborlight supports Ubuntu ${SUPPORTED_UBUNTU[*]} (detected: ${detected})."
      die ${EX_UNSUPPORTED} "Re-run with --force-unsupported to install anyway."
    fi
  fi
}

check_root_usage() {
  if [[ ${EUID} -eq 0 ]] && [[ -z "${SUDO_USER:-}" ]] && [[ -z "${TARGET_USER}" ]]; then
    warn "Running as root without SUDO_USER. Use --target-user to say which account Harborlight is for."
  fi
}

# -------------------------------------------------------------------- docker

docker_socket_path() {
  if [[ -n "${SOCKET}" ]]; then
    printf '%s' "${SOCKET}"
  elif [[ ${ROOTLESS} -eq 1 ]]; then
    printf '/run/user/%s/docker.sock' "$(id -u "${TARGET_USER}")"
  else
    printf '/var/run/docker.sock'
  fi
}

docker_status() {
  if ! have docker; then
    printf 'missing'
  elif docker info >/dev/null 2>&1; then
    printf 'ready'
  else
    printf 'unreachable'
  fi
}

install_docker() {
  info "Installing Docker from the Ubuntu archive (docker.io)."
  say "  Harborlight does not add third-party APT repositories on your behalf."
  say "  For Docker's own packages, follow https://docs.docker.com/engine/install/ubuntu/ first,"
  say "  then re-run this installer with --docker existing."
  confirm "Install the docker.io package now?" || die ${EX_ABORTED} "Docker installation declined."
  run_priv apt-get update
  run_priv apt-get install -y docker.io
  run_priv systemctl enable --now docker
}

install_compose() {
  info "Installing the Docker Compose v2 plugin (docker-compose-v2)."
  confirm "Install the docker-compose-v2 package now?" || die ${EX_ABORTED} "Compose installation declined."
  run_priv apt-get update
  run_priv apt-get install -y docker-compose-v2
}

add_to_docker_group() {
  if id -nG "${TARGET_USER}" | tr ' ' '\n' | grep -qx docker; then
    ok "${TARGET_USER} is already in the 'docker' group."
    return
  fi
  warn "Adding a user to the 'docker' group grants root-equivalent access to the host."
  warn "A safer alternative is rootless Docker (--rootless)."
  confirm "Add ${TARGET_USER} to the 'docker' group?" || {
    warn "Skipped. Harborlight will start but may not reach the Docker socket."
    return
  }
  run_priv usermod -aG docker "${TARGET_USER}"
  warn "${TARGET_USER} must log out and back in (or run 'newgrp docker') for the group to take effect."
}

# ------------------------------------------------------------------ artifacts

# Chooses the newest .deb in dist/ matching this architecture.
find_local_artifact() {
  local arch="$1"
  local candidate
  candidate="$(find "${SCRIPT_DIR}/dist" -maxdepth 1 -name "*_${arch}.deb" -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | head -n 1 | cut -d' ' -f2- || true)"
  printf '%s' "${candidate}"
}

download_release_artifact() {
  local arch="$1"
  local version="${REQUESTED_VERSION}"
  local base="${RELEASE_BASE_URL}"
  local workdir
  workdir="$(mktemp -d -t harborlight-download-XXXXXX)"
  add_rollback "rm -rf '${workdir}'"

  have curl || die ${EX_MISSING_DEP} "curl is required to download a release. Install it with: sudo apt-get install curl"

  if [[ -n "${version}" ]]; then
    base="${base%/latest/download}/download/v${version}"
  fi

  local deb="${workdir}/${APP_ID}_${arch}.deb"
  info "Downloading ${APP_NAME} (${CHANNEL} channel, ${arch})"
  debug "from ${base}"
  run curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    --output "${deb}" "${base}/${APP_ID}_${version:-latest}_${arch}.deb" ||
    die ${EX_ARTIFACT} "Could not download the .deb from ${base}. Pass --artifact <path> to install a file you already have."

  # Checksums are mandatory for anything fetched over the network.
  local sums="${workdir}/checksums.sha256"
  run curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    --output "${sums}" "${base}/checksums.sha256" ||
    die ${EX_ARTIFACT} "The release is missing checksums.sha256; refusing to install an unverified artifact."

  info "Verifying SHA-256 checksum"
  local expected actual
  expected="$(grep -F "$(basename "${deb}")" "${sums}" | awk '{print $1}' | head -n1)"
  [[ -n "${expected}" ]] || die ${EX_VERIFY} "No checksum entry for $(basename "${deb}") in checksums.sha256."
  actual="$(sha256sum "${deb}" | awk '{print $1}')"
  [[ "${expected}" == "${actual}" ]] || die ${EX_VERIFY} "Checksum mismatch. Expected ${expected}, got ${actual}."
  ok "Checksum verified."

  printf '%s' "${deb}"
}

resolve_artifact() {
  local arch="$1"

  if [[ -n "${ARTIFACT}" ]]; then
    [[ -f "${ARTIFACT}" ]] || die ${EX_ARTIFACT} "Artifact not found: ${ARTIFACT}"
    printf '%s' "${ARTIFACT}"
    return
  fi

  case "${SOURCE}" in
    local)
      local found
      found="$(find_local_artifact "${arch}")"
      [[ -n "${found}" ]] || die ${EX_ARTIFACT} \
        "No .deb for ${arch} in ${SCRIPT_DIR}/dist. Build one first with: make package"
      printf '%s' "${found}"
      ;;
    release)
      download_release_artifact "${arch}"
      ;;
    *)
      die ${EX_USAGE} "Unknown --source '${SOURCE}'. Use local or release."
      ;;
  esac
}

artifact_version() {
  local deb="$1"
  if have dpkg-deb; then
    dpkg-deb --field "${deb}" Version 2>/dev/null || printf 'unknown'
  else
    printf 'unknown'
  fi
}

# ------------------------------------------------------------------- install

install_deb() {
  local deb="$1"
  info "Installing ${deb##*/}"

  if have apt-get; then
    # `apt-get install ./file.deb` resolves dependencies; dpkg alone does not.
    run_priv apt-get install -y "${deb}"
  else
    run_priv dpkg --install "${deb}" || {
      warn "dpkg reported missing dependencies; attempting to fix."
      run_priv apt-get --fix-broken install -y
    }
  fi
}

install_launcher() {
  local target="${BIN_DIR}/${APP_ID}"
  local app_binary="/opt/${APP_NAME}/${APP_ID}"

  [[ -d "${BIN_DIR}" ]] || run_priv install -d -m 0755 "${BIN_DIR}"

  if [[ "${target}" == "${app_binary}" ]]; then
    return
  fi

  info "Linking ${target} -> ${app_binary}"
  run_priv ln -sf "${app_binary}" "${target}"
  add_rollback "run_priv rm -f '${target}'"
}

configure_autostart() {
  local home autostart_dir autostart_file exec_line
  home="$(target_home)"
  autostart_dir="${home}/.config/autostart"
  autostart_file="${autostart_dir}/${DESKTOP_FILE_NAME}"

  if [[ ${AUTOSTART} -eq 0 ]]; then
    if [[ -f "${autostart_file}" ]]; then
      info "Removing autostart entry"
      run rm -f "${autostart_file}"
    fi
    return
  fi

  exec_line="${BIN_DIR}/${APP_ID}"
  [[ ${START_MINIMIZED} -eq 1 ]] && exec_line="${exec_line} --hidden"

  info "Enabling autostart for ${TARGET_USER}"
  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '%s writing %s\n' "${C_DIM}dry-run${C_RESET}" "${autostart_file}"
    return
  fi

  # Kept byte-identical to buildAutostartDesktopEntry() in
  # src/main/services/autostart.ts so the installer and the in-app toggle do not
  # fight over the file.
  as_target_user mkdir -p "${autostart_dir}"
  as_target_user tee "${autostart_file}" >/dev/null <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
GenericName=Container Manager
Comment=Container workflows, reimagined for Ubuntu
Exec=${exec_line}
Icon=${APP_ID}
Terminal=false
Categories=Development;System;
StartupWMClass=${APP_ID}
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
EOF
  add_rollback "rm -f '${autostart_file}'"
  ok "Autostart entry written to ${autostart_file}"
}

# Runs a command as the target user, even when the script itself is root.
as_target_user() {
  if [[ "$(id -un)" == "${TARGET_USER}" ]]; then
    "$@"
  else
    run_priv sudo -u "${TARGET_USER}" -H "$@"
  fi
}

remove_desktop_entry() {
  local file="/usr/share/applications/${DESKTOP_FILE_NAME}"
  [[ -f "${file}" ]] || return 0
  info "Removing desktop entry"
  run_priv rm -f "${file}"
}

launch_app() {
  [[ ${LAUNCH} -eq 1 ]] || return 0
  if [[ "$(id -un)" == "root" ]] && [[ "${TARGET_USER}" == "root" ]]; then
    warn "Refusing to launch Harborlight as root. Start it from a desktop session instead."
    return 0
  fi
  info "Launching ${APP_NAME}"
  local args=()
  [[ ${START_MINIMIZED} -eq 1 ]] && args+=("--hidden")
  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '%s %s %s\n' "${C_DIM}dry-run${C_RESET}" "${BIN_DIR}/${APP_ID}" "${args[*]:-}"
    return 0
  fi
  as_target_user nohup "${BIN_DIR}/${APP_ID}" "${args[@]}" >/dev/null 2>&1 &
  disown || true
}

verify_installation() {
  local binary="${BIN_DIR}/${APP_ID}"
  info "Verifying installation"

  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '%s verify %s --version\n' "${C_DIM}dry-run${C_RESET}" "${binary}"
    return 0
  fi

  [[ -x "${binary}" ]] || die ${EX_VERIFY} "Expected an executable at ${binary}."

  local reported=""
  reported="$("${binary}" --version 2>/dev/null | head -n1 || true)"
  if [[ -z "${reported}" ]]; then
    warn "'${APP_ID} --version' produced no output. The package is installed, but check it manually."
  else
    ok "${reported}"
  fi

  if [[ ${DESKTOP_ENTRY} -eq 1 ]]; then
    if [[ -f "/usr/share/applications/${DESKTOP_FILE_NAME}" ]]; then
      ok "Desktop entry installed."
    else
      warn "Desktop entry not found at /usr/share/applications/${DESKTOP_FILE_NAME}."
    fi
  fi

  if [[ ${AUTOSTART} -eq 1 ]]; then
    local autostart_file="$(target_home)/.config/autostart/${DESKTOP_FILE_NAME}"
    [[ -f "${autostart_file}" ]] && ok "Autostart entry installed." || warn "Autostart entry missing."
  fi
}

print_plan() {
  local arch="$1" artifact="$2"
  say ""
  say "${C_BOLD}Installation plan${C_RESET}"
  say "  Command          ${COMMAND}"
  say "  Source           ${SOURCE}$([[ -n "${ARTIFACT}" ]] && printf ' (--artifact)')"
  say "  Artifact         ${artifact:-<resolved later>}"
  say "  Version          $([[ -f "${artifact}" ]] && artifact_version "${artifact}" || printf '%s' "${REQUESTED_VERSION:-latest}")"
  say "  Channel          ${CHANNEL}"
  say "  Architecture     ${arch}"
  say "  Install dir      /opt/${APP_NAME} (from the .deb)"
  say "  Launcher         ${BIN_DIR}/${APP_ID}"
  say "  Desktop entry    $([[ ${DESKTOP_ENTRY} -eq 1 ]] && echo yes || echo no)"
  say "  Autostart        $([[ ${AUTOSTART} -eq 1 ]] && echo "yes$([[ ${START_MINIMIZED} -eq 1 ]] && echo ' (minimised)')" || echo no)"
  say "  Target user      ${TARGET_USER}"
  say "  Docker           ${DOCKER_MODE} (socket: $(docker_socket_path))"
  say "  Compose          ${COMPOSE_MODE}"
  say "  Docker group     $([[ ${ADD_USER_TO_DOCKER_GROUP} -eq 1 ]] && echo "add ${TARGET_USER}" || echo "unchanged")"
  say "  Launch after     $([[ ${LAUNCH} -eq 1 ]] && echo yes || echo no)"
  say "  Log file         ${LOG_FILE:-<none>}"
  [[ ${DRY_RUN} -eq 1 ]] && say "  ${C_YELLOW}Dry run: nothing will be modified.${C_RESET}"
  say ""
}

cmd_install() {
  local arch artifact
  detect_target_user
  check_root_usage
  check_platform
  arch="$(detect_arch)"

  LOG_FILE="$(mktemp -t harborlight-install-XXXXXX.log)"
  log_to_file "${SCRIPT_NAME} ${COMMAND} arch=${arch} user=${TARGET_USER}"

  artifact="$(resolve_artifact "${arch}")"
  print_plan "${arch}" "${artifact}"

  confirm "Proceed with this plan?" || die ${EX_ABORTED} "Aborted at the confirmation prompt."

  INSTALL_STARTED=1

  case "${DOCKER_MODE}" in
    install) install_docker ;;
    skip) debug "Skipping Docker checks (--docker skip)." ;;
    existing)
      case "$(docker_status)" in
        missing) warn "Docker is not installed. Harborlight will start, but nothing will be manageable until it is." ;;
        unreachable) warn "Docker is installed but not reachable as ${TARGET_USER}. See 'harborlight doctor' output below." ;;
        ready) ok "Docker is reachable." ;;
      esac
      ;;
    *) die ${EX_USAGE} "Unknown --docker mode '${DOCKER_MODE}'." ;;
  esac

  case "${COMPOSE_MODE}" in
    install) install_compose ;;
    skip) debug "Skipping Compose checks (--compose skip)." ;;
    existing)
      if docker compose version >/dev/null 2>&1; then
        ok "Docker Compose v2 is available."
      else
        warn "Docker Compose v2 was not found. Compose Studio will be read-only until it is installed."
      fi
      ;;
    *) die ${EX_USAGE} "Unknown --compose mode '${COMPOSE_MODE}'." ;;
  esac

  [[ ${ADD_USER_TO_DOCKER_GROUP} -eq 1 ]] && add_to_docker_group

  install_deb "${artifact}"
  install_launcher
  [[ ${DESKTOP_ENTRY} -eq 0 ]] && remove_desktop_entry
  configure_autostart
  verify_installation

  ROLLBACK_ACTIONS=()
  print_post_install
  launch_app
}

print_post_install() {
  say ""
  say "${C_GREEN}${C_BOLD}${APP_NAME} is installed.${C_RESET}"
  say ""
  say "  Start it from your application menu, or run:"
  say "    ${BIN_DIR}/${APP_ID}"
  say ""
  say "  Check the version:            ${APP_ID} --version"
  say "  Diagnose the environment:     ${SCRIPT_NAME} doctor"
  say "  Uninstall (keep settings):    sudo ${SCRIPT_NAME} uninstall"
  say "  Uninstall (delete settings):  sudo ${SCRIPT_NAME} uninstall --purge"
  if [[ ${ADD_USER_TO_DOCKER_GROUP} -eq 1 ]]; then
    say ""
    say "  ${C_YELLOW}Log out and back in${C_RESET} so the 'docker' group membership applies."
  fi
  [[ -n "${LOG_FILE}" ]] && say "" && say "  Installation log: ${LOG_FILE}"
  say ""
}

cmd_uninstall() {
  detect_target_user
  info "Uninstalling ${APP_NAME}"

  if dpkg -s "${APP_ID}" >/dev/null 2>&1; then
    if [[ ${PURGE} -eq 1 ]]; then
      run_priv apt-get purge -y "${APP_ID}"
    else
      run_priv apt-get remove -y "${APP_ID}"
    fi
  else
    warn "The ${APP_ID} package is not installed."
  fi

  local launcher="${BIN_DIR}/${APP_ID}"
  [[ -L "${launcher}" || -f "${launcher}" ]] && run_priv rm -f "${launcher}"

  local autostart_file="$(target_home)/.config/autostart/${DESKTOP_FILE_NAME}"
  [[ -f "${autostart_file}" ]] && run rm -f "${autostart_file}"

  if [[ ${PURGE} -eq 1 ]]; then
    local home config_dir cache_dir
    home="$(target_home)"
    config_dir="${home}/.config/${APP_NAME}"
    cache_dir="${home}/.cache/${APP_NAME}"
    warn "--purge deletes settings and stored registry credentials for ${TARGET_USER}."
    if confirm "Delete ${config_dir} and ${cache_dir}?"; then
      run rm -rf "${config_dir}" "${cache_dir}"
      ok "User data removed."
    else
      say "Kept user data."
    fi
  else
    say "User settings in $(target_home)/.config/${APP_NAME} were kept."
  fi

  ok "${APP_NAME} removed."
}

# --------------------------------------------------------------------- doctor

doctor_line() {
  local status="$1" label="$2" detail="${3:-}"
  local mark
  case "${status}" in
    ok) mark="${C_GREEN}✔${C_RESET}" ;;
    warn) mark="${C_YELLOW}!${C_RESET}" ;;
    *) mark="${C_RED}✘${C_RESET}" ;;
  esac
  printf '  %s %-28s %s\n' "${mark}" "${label}" "${detail}"
}

cmd_doctor() {
  detect_target_user
  local arch id version
  arch="$(detect_arch)"
  id="$(os_release_value ID)"
  version="$(os_release_value VERSION_ID)"

  say ""
  say "${C_BOLD}${APP_NAME} doctor${C_RESET}"
  say ""

  local supported=0 candidate
  for candidate in "${SUPPORTED_UBUNTU[@]}"; do
    [[ "${id}" == "ubuntu" && "${version}" == "${candidate}" ]] && supported=1
  done
  if [[ ${supported} -eq 1 ]]; then
    doctor_line ok "Operating system" "$(os_release_value PRETTY_NAME)"
  else
    doctor_line warn "Operating system" "$(os_release_value PRETTY_NAME) (supported: Ubuntu ${SUPPORTED_UBUNTU[*]})"
  fi

  if [[ "${arch}" == "unsupported" ]]; then
    doctor_line fail "Architecture" "$(uname -m)"
  else
    doctor_line ok "Architecture" "${arch}"
  fi

  doctor_line ok "Session" "${XDG_SESSION_TYPE:-unknown} / ${XDG_CURRENT_DESKTOP:-unknown}"

  case "$(docker_status)" in
    ready) doctor_line ok "Docker Engine" "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo reachable)" ;;
    unreachable) doctor_line warn "Docker Engine" "installed but not reachable as $(id -un)" ;;
    missing) doctor_line fail "Docker Engine" "not installed" ;;
  esac

  local socket
  socket="$(docker_socket_path)"
  if [[ -S "${socket}" ]]; then
    if [[ -r "${socket}" && -w "${socket}" ]]; then
      doctor_line ok "Docker socket" "${socket}"
    else
      doctor_line warn "Docker socket" "${socket} exists but is not readable/writable by $(id -un)"
    fi
  else
    doctor_line fail "Docker socket" "${socket} not found"
  fi

  if id -nG "${TARGET_USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    doctor_line warn "docker group" "${TARGET_USER} is a member (root-equivalent access)"
  else
    doctor_line ok "docker group" "${TARGET_USER} is not a member"
  fi

  if docker compose version >/dev/null 2>&1; then
    doctor_line ok "Docker Compose" "$(docker compose version --short 2>/dev/null || echo v2)"
  else
    doctor_line warn "Docker Compose" "v2 plugin not found"
  fi

  if have "${BIN_DIR}/${APP_ID}" || have "${APP_ID}"; then
    doctor_line ok "Harborlight" "$("${APP_ID}" --version 2>/dev/null | head -n1 || echo installed)"
  else
    doctor_line warn "Harborlight" "not installed"
  fi

  if [[ -f "/usr/share/applications/${DESKTOP_FILE_NAME}" ]]; then
    doctor_line ok "Desktop entry" "/usr/share/applications/${DESKTOP_FILE_NAME}"
  else
    doctor_line warn "Desktop entry" "not installed"
  fi

  if [[ -f "$(target_home)/.config/autostart/${DESKTOP_FILE_NAME}" ]]; then
    doctor_line ok "Autostart" "enabled for ${TARGET_USER}"
  else
    doctor_line ok "Autostart" "disabled"
  fi

  if have trivy; then
    doctor_line ok "Trivy (optional)" "$(trivy --version 2>/dev/null | head -n1)"
  else
    doctor_line warn "Trivy (optional)" "not installed; image scanning is unavailable"
  fi

  say ""
  say "Docs: docs/TROUBLESHOOTING.md"
  say ""
}

cmd_version() {
  local pkg_version="unknown"
  if [[ -f "${SCRIPT_DIR}/package.json" ]] && have node; then
    pkg_version="$(node -p "require('${SCRIPT_DIR}/package.json').version" 2>/dev/null || echo unknown)"
  fi
  say "${APP_NAME} installer"
  say "  repository version : ${pkg_version}"
  if dpkg -s "${APP_ID}" >/dev/null 2>&1; then
    say "  installed package  : $(dpkg -s "${APP_ID}" | awk '/^Version:/{print $2}')"
  else
    say "  installed package  : none"
  fi
  if have "${APP_ID}"; then
    say "  binary reports     : $("${APP_ID}" --version 2>/dev/null | head -n1)"
  fi
}

usage() {
  cat <<EOF
${APP_NAME} installer

Usage:
  ${SCRIPT_NAME} <command> [options]

Commands:
  install            Install Harborlight (idempotent; upgrades in place)
  upgrade            Alias for install
  uninstall          Remove Harborlight, keeping user settings
  doctor             Check the environment and report problems
  version            Show installer, package and binary versions
  help               Show this help

Options:
  --source local|release   Where the artifact comes from (default: local)
  --artifact <path>        Install this .deb instead of resolving one
  --version <semver>       Release version to fetch (with --source release)
  --channel stable|beta    Release channel (default: stable)
  --install-dir <path>     Reserved; the .deb installs under /opt/${APP_NAME}
  --bin-dir <path>         Where to create the launcher (default: ${DEFAULT_BIN_DIR})
  --target-user <user>     Account to configure autostart and checks for
  --desktop-entry          Install the .desktop entry (default)
  --no-desktop-entry       Remove the .desktop entry after installing
  --autostart              Start Harborlight at login
  --no-autostart           Do not start at login (default)
  --start-minimized        With --autostart, start hidden in the tray
  --launch                 Launch Harborlight when the install finishes
  --no-launch              Do not launch afterwards (default)
  --docker existing|install|skip    How to handle Docker (default: existing)
  --compose existing|install|skip   How to handle Compose v2 (default: existing)
  --add-user-to-docker-group        Add the target user to the docker group (asks first)
  --rootless               Assume a rootless Docker socket for the target user
  --socket <path>          Use this Docker socket in checks
  --yes                    Do not prompt; accept every confirmation
  --dry-run                Print what would happen and change nothing
  --verbose                Print each command as it runs
  --force-unsupported      Install on a non-supported distribution or release
  --purge                  With uninstall, also delete user settings

Examples:
  ${SCRIPT_NAME} install --source local --yes
  ${SCRIPT_NAME} install --autostart --start-minimized --launch
  ${SCRIPT_NAME} install --source release --channel stable --version 0.1.0
  ${SCRIPT_NAME} uninstall --purge
  ${SCRIPT_NAME} doctor

Exit codes:
  ${EX_OK} success   ${EX_USAGE} usage   ${EX_UNSUPPORTED} unsupported platform   ${EX_MISSING_DEP} missing dependency
  ${EX_ARTIFACT} artifact problem   ${EX_PRIVILEGE} privilege problem   ${EX_VERIFY} verification failed   ${EX_ABORTED} aborted
EOF
}

parse_args() {
  [[ $# -gt 0 ]] || { usage; exit ${EX_USAGE}; }

  COMMAND="$1"
  shift

  case "${COMMAND}" in
    install|upgrade|uninstall|doctor|version|help|--help|-h) ;;
    *) err "Unknown command: ${COMMAND}"; usage; exit ${EX_USAGE} ;;
  esac

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source) SOURCE="${2:?--source needs a value}"; shift 2 ;;
      --artifact) ARTIFACT="${2:?--artifact needs a path}"; shift 2 ;;
      --version) REQUESTED_VERSION="${2:?--version needs a value}"; shift 2 ;;
      --channel) CHANNEL="${2:?--channel needs a value}"; shift 2 ;;
      --install-dir) INSTALL_DIR="${2:?--install-dir needs a path}"; shift 2 ;;
      --bin-dir) BIN_DIR="${2:?--bin-dir needs a path}"; shift 2 ;;
      --target-user) TARGET_USER="${2:?--target-user needs a username}"; shift 2 ;;
      --desktop-entry) DESKTOP_ENTRY=1; shift ;;
      --no-desktop-entry) DESKTOP_ENTRY=0; shift ;;
      --autostart) AUTOSTART=1; shift ;;
      --no-autostart) AUTOSTART=0; shift ;;
      --start-minimized) START_MINIMIZED=1; shift ;;
      --launch) LAUNCH=1; shift ;;
      --no-launch) LAUNCH=0; shift ;;
      --docker) DOCKER_MODE="${2:?--docker needs a mode}"; shift 2 ;;
      --compose) COMPOSE_MODE="${2:?--compose needs a mode}"; shift 2 ;;
      --add-user-to-docker-group) ADD_USER_TO_DOCKER_GROUP=1; shift ;;
      --rootless) ROOTLESS=1; shift ;;
      --socket) SOCKET="${2:?--socket needs a path}"; shift 2 ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --verbose) VERBOSE=1; shift ;;
      --force-unsupported) FORCE_UNSUPPORTED=1; shift ;;
      --purge) PURGE=1; shift ;;
      --help|-h) usage; exit ${EX_OK} ;;
      *) err "Unknown option: $1"; usage; exit ${EX_USAGE} ;;
    esac
  done

  [[ "${CHANNEL}" =~ ^(stable|beta)$ ]] || die ${EX_USAGE} "--channel must be stable or beta."
  if [[ -n "${REQUESTED_VERSION}" ]] && [[ ! "${REQUESTED_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    die ${EX_USAGE} "--version must be a semantic version such as 1.2.3 or 1.2.3-beta.1."
  fi
}

main() {
  parse_args "$@"
  case "${COMMAND}" in
    install|upgrade) cmd_install ;;
    uninstall) cmd_uninstall ;;
    doctor) cmd_doctor ;;
    version) cmd_version ;;
    help|--help|-h) usage ;;
  esac
}

main "$@"
