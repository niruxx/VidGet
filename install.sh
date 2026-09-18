#!/usr/bin/env bash
#
# Vidget installer for Linux.
#
# Run from inside a clone of the repository:
#   git clone https://github.com/niruxx/VidGet.git && cd VidGet && ./install.sh
#
# It checks/installs prerequisites, installs the npm dependencies, sets the
# listening port and (optionally) creates and enables a systemd service so
# Vidget starts automatically. Safe to re-run: existing user data (Saves/,
# logs/, config.json) is never modified except for the port you choose.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_NAME="vidget"
MIN_NODE_MAJOR=18
NODESOURCE_MAJOR=22

SERVICE_MODE=""   # system | user | none
PORT=""
ASSUME_YES=0
DRY_RUN=0

if [[ -t 1 ]]; then
  C_BLUE=$'\033[1;34m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

log()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: ./install.sh [options]

Sets up Vidget in this directory: checks/installs prerequisites, installs npm
dependencies, configures the port, and optionally creates and enables a
systemd service so it starts automatically.

Options:
  --system         Install a system-wide systemd service (starts at boot; uses sudo)
  --user-service   Install a per-user systemd service (no root required)
  --no-service     Do not set up a service
  --port PORT      Port to listen on (saved to config.json)
  --name NAME      Service name (default: ${SERVICE_NAME})
  -y, --yes        Non-interactive: answer yes to prompts and use defaults
  --dry-run        Print what would be done (including the unit file); change nothing
  -h, --help       Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --system)       SERVICE_MODE=system ;;
      --user-service) SERVICE_MODE=user ;;
      --no-service)   SERVICE_MODE=none ;;
      --port)         [[ $# -ge 2 ]] || die "--port needs a value"; PORT="$2"; shift ;;
      --name)         [[ $# -ge 2 ]] || die "--name needs a value"; SERVICE_NAME="$2"; shift ;;
      -y|--yes)       ASSUME_YES=1 ;;
      --dry-run)      DRY_RUN=1 ;;
      -h|--help)      usage; exit 0 ;;
      *)              usage >&2; die "Unknown option: $1" ;;
    esac
    shift
  done
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "Invalid service name: $SERVICE_NAME"
}

# confirm "question" [y|n]  -> returns 0 for yes
confirm() {
  local prompt="$1" default="${2:-n}" reply hint
  if (( ASSUME_YES )); then return 0; fi
  if [[ ! -t 0 ]]; then [[ "$default" == y ]]; return; fi
  if [[ "$default" == y ]]; then hint="[Y/n]"; else hint="[y/N]"; fi
  read -r -p "$prompt $hint " reply || reply=""
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

run() {
  if (( DRY_RUN )); then
    printf '    (dry-run) %s\n' "$*"
  else
    "$@"
  fi
}

as_root() {
  command -v sudo >/dev/null 2>&1 || die "sudo is required for: $* (install sudo, or run these steps manually)"
  sudo "$@"
}

have_systemd() {
  command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]
}

detect_pkg_manager() {
  local pm
  for pm in apt-get dnf yum pacman zypper apk; do
    if command -v "$pm" >/dev/null 2>&1; then echo "$pm"; return; fi
  done
  echo ""
}

pkg_install() {
  local pm="$1"; shift
  case "$pm" in
    apt-get) run as_root apt-get update; run as_root apt-get install -y "$@" ;;
    dnf|yum) run as_root "$pm" install -y "$@" ;;
    pacman)  run as_root pacman -S --needed --noconfirm "$@" ;;
    zypper)  run as_root zypper --non-interactive install "$@" ;;
    apk)     run as_root apk add "$@" ;;
    *)       die "Unsupported package manager: $pm" ;;
  esac
}

node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

ensure_prereqs() {
  local pm py missing=()
  pm="$(detect_pkg_manager)"
  py="python3"; [[ "$pm" == pacman ]] && py="python"

  command -v git     >/dev/null 2>&1 || missing+=(git)
  command -v curl    >/dev/null 2>&1 || missing+=(curl)
  command -v python3 >/dev/null 2>&1 || missing+=("$py")

  if (( ${#missing[@]} > 0 )); then
    warn "Missing required packages: ${missing[*]}"
    [[ -n "$pm" ]] || die "No supported package manager found. Install (${missing[*]}) manually and re-run."
    confirm "Install them now with ${pm} (uses sudo)?" y || die "Cannot continue without: ${missing[*]}"
    pkg_install "$pm" "${missing[@]}"
  fi

  ensure_node "$pm"
}

install_node() {
  local pm="$1"
  case "$pm" in
    apt-get)
      confirm "Install Node.js ${NODESOURCE_MAJOR}.x from NodeSource? (downloads and runs their setup script as root)" y || return 1
      run bash -c "curl -fsSL https://deb.nodesource.com/setup_${NODESOURCE_MAJOR}.x | sudo -E bash -"
      run as_root apt-get install -y nodejs
      ;;
    dnf|yum)
      confirm "Install Node.js ${NODESOURCE_MAJOR}.x from NodeSource? (downloads and runs their setup script as root)" y || return 1
      run bash -c "curl -fsSL https://rpm.nodesource.com/setup_${NODESOURCE_MAJOR}.x | sudo bash -"
      run as_root "$pm" install -y nodejs
      ;;
    pacman)
      confirm "Install nodejs and npm with pacman (uses sudo)?" y || return 1
      pkg_install pacman nodejs npm
      ;;
    apk)
      confirm "Install nodejs and npm with apk (uses sudo)?" y || return 1
      pkg_install apk nodejs npm
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_node() {
  local pm="$1" major=0
  if command -v node >/dev/null 2>&1; then major="$(node_major)"; fi

  if (( major >= MIN_NODE_MAJOR )) && command -v npm >/dev/null 2>&1; then
    log "Node.js $(node -v) and npm $(npm -v) found"
    return
  fi

  if (( major > 0 )); then
    warn "Node.js v${major} is too old (need >= ${MIN_NODE_MAJOR})."
  else
    warn "Node.js / npm not found."
  fi

  if ! install_node "$pm"; then
    die "Node.js >= ${MIN_NODE_MAJOR} with npm is required. Install it (e.g. from https://nodejs.org or via nvm) and re-run."
  fi

  if (( DRY_RUN )); then return; fi
  hash -r
  major="$(node_major)"
  (( major >= MIN_NODE_MAJOR )) || die "Node.js >= ${MIN_NODE_MAJOR} is still not available (found v${major})."
  log "Installed Node.js $(node -v)"
}

# yt-dlp-exec's npm preinstall runs `npx bin-version-check-cli python ">=2"`, which
# fails on distros that only ship `python3`. Provide a temporary `python` shim.
install_dependencies() {
  log "Installing npm dependencies (downloads ffmpeg and yt-dlp binaries)"
  if (( DRY_RUN )); then
    printf '    (dry-run) npm ci --omit=dev  (in %s)\n' "$APP_DIR"
    return
  fi

  cd "$APP_DIR"
  local shim="" rc=0
  if ! command -v python >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    shim="$(mktemp -d)"
    ln -s "$(command -v python3)" "$shim/python"
    export PATH="$shim:$PATH"
  fi

  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev || rc=$?
  else
    npm install --omit=dev || rc=$?
  fi

  if [[ -n "$shim" ]]; then rm -rf "$shim"; fi
  (( rc == 0 )) || die "npm install failed (exit $rc)."
}

verify_binaries() {
  (( DRY_RUN )) && return 0
  cd "$APP_DIR"

  local ffmpeg_bin ffprobe_bin ytdlp_bin
  ffmpeg_bin="$(node -p "require('ffmpeg-static')" 2>/dev/null || true)"
  ffprobe_bin="$(node -p "require('ffprobe-static').path" 2>/dev/null || true)"
  ytdlp_bin="$APP_DIR/node_modules/yt-dlp-exec/bin/yt-dlp"

  [[ -n "$ffmpeg_bin"  && -x "$ffmpeg_bin"  ]] || warn "ffmpeg binary not found — conversions will fail. Try: npm rebuild ffmpeg-static"
  [[ -n "$ffprobe_bin" && -x "$ffprobe_bin" ]] || warn "ffprobe binary not found."
  if [[ -x "$ytdlp_bin" ]]; then
    "$ytdlp_bin" --version >/dev/null 2>&1 \
      && log "yt-dlp $("$ytdlp_bin" --version) ready" \
      || warn "yt-dlp is installed but failed to run (is python3 working?)"
  else
    warn "yt-dlp binary not found — downloads will fail. Try: npm rebuild yt-dlp-exec"
  fi
}

configure_port() {
  cd "$APP_DIR"
  local current=3000
  if command -v node >/dev/null 2>&1 && [[ -f config.json ]]; then
    current="$(node -e "try{const p=JSON.parse(require('fs').readFileSync('config.json','utf8')).port;console.log(Number.isInteger(p)?p:3000)}catch{console.log(3000)}")"
  fi

  if [[ -z "$PORT" ]]; then
    PORT="$current"
    if (( ! ASSUME_YES )) && [[ -t 0 ]]; then
      local reply
      read -r -p "Port to listen on [${current}]: " reply || reply=""
      PORT="${reply:-$current}"
    fi
  fi

  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "Invalid port: $PORT"

  if [[ "$PORT" != "$current" ]]; then
    log "Setting port to ${PORT} in config.json"
    if (( ! DRY_RUN )); then
      node -e "
        const fs = require('fs');
        let c = {};
        try { c = JSON.parse(fs.readFileSync('config.json', 'utf8')); } catch {}
        c.port = Number(process.argv[1]);
        fs.writeFileSync('config.json', JSON.stringify(c, null, 2) + '\n');
      " "$PORT"
    fi
  else
    log "Using port ${PORT}"
  fi
}

choose_service_mode() {
  if [[ -n "$SERVICE_MODE" ]]; then
    if [[ "$SERVICE_MODE" != none ]] && ! have_systemd; then
      die "systemd was not detected on this machine; use --no-service."
    fi
    return
  fi

  if ! have_systemd; then
    warn "systemd not detected; skipping service setup."
    SERVICE_MODE=none
    return
  fi

  if (( ASSUME_YES )); then SERVICE_MODE=system; return; fi
  if [[ ! -t 0 ]]; then
    warn "Not interactive and no --system/--user-service/--no-service given; skipping service setup."
    SERVICE_MODE=none
    return
  fi

  echo
  echo "How should Vidget run?"
  echo "  1) System service - starts at boot, runs as '$(id -un)' (uses sudo to install)"
  echo "  2) User service   - no root needed; starts at boot only if lingering is enabled"
  echo "  3) Don't set up a service"
  local reply
  read -r -p "Choose [1]: " reply || reply=""
  case "${reply:-1}" in
    1) SERVICE_MODE=system ;;
    2) SERVICE_MODE=user ;;
    *) SERVICE_MODE=none ;;
  esac
}

# systemd treats % specially in unit files.
esc() { printf '%s' "${1//\%/%%}"; }

generate_unit() {
  local mode="$1" node_bin="$2" extra=""
  if [[ "$mode" == system ]]; then
    extra+="User=$(id -un)"$'\n'
    extra+="Group=$(id -gn)"$'\n'
    if (( PORT < 1024 )); then extra+="AmbientCapabilities=CAP_NET_BIND_SERVICE"$'\n'; fi
  fi

  cat <<EOF
[Unit]
Description=Vidget - media downloader and converter
Documentation=https://github.com/niruxx/VidGet
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${extra}WorkingDirectory=$(esc "$APP_DIR")
ExecStart="$(esc "$node_bin")" "$(esc "$APP_DIR")/server.js"
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=$([[ "$mode" == system ]] && echo multi-user.target || echo default.target)
EOF
}

setup_service() {
  [[ "$SERVICE_MODE" != none ]] || return 0

  local node_bin
  node_bin="$(readlink -f "$(command -v node 2>/dev/null || echo /usr/bin/node)")"
  if [[ "$node_bin" == *"/.nvm/"* || "$node_bin" == *"/.volta/"* || "$node_bin" == *"/.fnm/"* ]]; then
    warn "Node is managed by a version manager ($node_bin). The service is pinned to that path; re-run ./install.sh after switching Node versions."
  fi
  if (( PORT < 1024 )) && [[ "$SERVICE_MODE" == user ]]; then
    warn "Port ${PORT} is privileged; a user service cannot bind it. Choose a port >= 1024 or use --system."
  fi

  local unit unit_path tmp
  unit="$(generate_unit "$SERVICE_MODE" "$node_bin")"

  if (( DRY_RUN )); then
    echo
    echo "--- ${SERVICE_NAME}.service (${SERVICE_MODE}) ---"
    echo "$unit"
    echo "---"
    return
  fi

  if [[ "$SERVICE_MODE" == system ]]; then
    unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
    [[ -f "$unit_path" ]] && log "Updating existing $unit_path" || log "Creating $unit_path"
    tmp="$(mktemp)"
    printf '%s\n' "$unit" > "$tmp"
    as_root install -m 644 "$tmp" "$unit_path"
    rm -f "$tmp"
    as_root systemctl daemon-reload
    as_root systemctl enable --now "${SERVICE_NAME}.service"
  else
    local unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    unit_path="$unit_dir/${SERVICE_NAME}.service"
    mkdir -p "$unit_dir"
    [[ -f "$unit_path" ]] && log "Updating existing $unit_path" || log "Creating $unit_path"
    printf '%s\n' "$unit" > "$unit_path"
    systemctl --user daemon-reload || die "Could not reach the systemd user manager (no login session?). Try again from a normal login shell."
    systemctl --user enable --now "${SERVICE_NAME}.service"
    if confirm "Enable lingering so the service starts at boot without you logging in?" y; then
      loginctl enable-linger "$(id -un)" 2>/dev/null \
        || as_root loginctl enable-linger "$(id -un)" \
        || warn "Could not enable lingering; run: sudo loginctl enable-linger $(id -un)"
    fi
  fi
}

wait_for_http() {
  command -v curl >/dev/null 2>&1 || return 0
  local i
  for i in $(seq 1 20); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

print_summary() {
  echo
  if (( DRY_RUN )); then
    log "Dry run complete; nothing was changed."
    return
  fi

  if [[ "$SERVICE_MODE" != none ]]; then
    if wait_for_http; then
      log "Vidget is running."
    else
      warn "The service was started but nothing is answering on port ${PORT} yet. Check the logs below."
    fi
  fi

  echo "Open:  http://localhost:${PORT}"
  if command -v hostname >/dev/null 2>&1; then
    local ip
    for ip in $(hostname -I 2>/dev/null || true); do
      [[ "$ip" == *:* ]] || echo "       http://${ip}:${PORT}"
    done
  fi
  echo
  case "$SERVICE_MODE" in
    system)
      echo "Manage:  sudo systemctl status|restart|stop ${SERVICE_NAME}"
      echo "Logs:    journalctl -u ${SERVICE_NAME} -f"
      ;;
    user)
      echo "Manage:  systemctl --user status|restart|stop ${SERVICE_NAME}"
      echo "Logs:    journalctl --user -u ${SERVICE_NAME} -f"
      ;;
    none)
      echo "Start manually:  cd '${APP_DIR}' && npm start"
      ;;
  esac
  echo "Update:  ${APP_DIR}/update.sh   (keeps Saves/, logs/ and config.json)"
  echo "Config:  ${APP_DIR}/config.json (port, log retention, saves retention)"
  echo
  warn "Vidget has no authentication and listens on all network interfaces. If this machine is reachable from untrusted networks, restrict access with a firewall or a reverse proxy."
}

main() {
  parse_args "$@"

  [[ "$(uname -s)" == Linux ]] || die "This installer is for Linux."
  [[ $EUID -ne 0 ]] || die "Run as the regular user that should own Vidget (sudo is used only where needed)."
  [[ -f "$APP_DIR/server.js" && -f "$APP_DIR/package.json" ]] || die "Run this script from the Vidget repository."

  (( DRY_RUN )) && log "Dry run: no changes will be made."
  log "Installing Vidget from ${APP_DIR}"

  ensure_prereqs
  install_dependencies
  verify_binaries
  configure_port
  choose_service_mode
  setup_service
  print_summary
}

main "$@"
