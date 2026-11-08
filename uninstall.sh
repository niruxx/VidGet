#!/usr/bin/env bash
# Undo install.sh. Run as the same regular user that ran the installer.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_NAME=vidget
SERVICE_MODE=auto
ASSUME_YES=0
DRY_RUN=0
DISABLE_LINGER=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: bash uninstall.sh [options]

Stop, disable and remove the service created by install.sh, then permanently
delete this checkout's data/, Saves/, logs/, tmp/, config.json and node_modules/.
Source files and Git history remain. Shared system packages are kept.

Options:
  --system          Remove only the system-wide service
  --user-service    Remove only the current user's service
  --no-service      Remove local files only (stop any manual server first)
  --name NAME       Service name used with install.sh (default: vidget)
  --disable-linger  Also disable lingering for this user (affects other services)
  -y, --yes         Confirm permanent deletion without prompting
  --dry-run         Print the removal commands; change nothing
  -h, --help        Show this help

By default, check both service locations used by install.sh. Run from the same
user account as installation, without sudo; sudo is used for system operations.
Custom VIDGET_* data paths outside this checkout are not removed.
EOF
}

while (( $# )); do
  case "$1" in
    --system) SERVICE_MODE=system ;;
    --user-service) SERVICE_MODE=user ;;
    --no-service) SERVICE_MODE=none ;;
    --name) (( $# >= 2 )) || die '--name needs a value'; SERVICE_NAME="$2"; shift ;;
    --disable-linger) DISABLE_LINGER=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ && "$SERVICE_NAME" != -* ]] || die 'Invalid service name'
[[ "$(uname -s)" == Linux ]] || die 'This uninstaller is for Linux.'
(( EUID != 0 )) || die 'Run as the regular user who installed the app, without sudo.'
[[ "$APP_DIR" != / && -f "$APP_DIR/server.js" && -f "$APP_DIR/package.json" ]] || die 'Keep this script in the Vidget repository.'

run() {
  if (( DRY_RUN )); then
    printf '  (dry-run)'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}
as_root() {
  command -v sudo >/dev/null 2>&1 || die 'sudo is required to remove the system service.'
  sudo "$@"
}

UNIT="${SERVICE_NAME}.service"
SYSTEM_UNIT="/etc/systemd/system/$UNIT"
USER_UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"
REMOVE_SYSTEM=0
REMOVE_USER=0
if [[ "$SERVICE_MODE" == system || "$SERVICE_MODE" == auto ]]; then
  if [[ -e "$SYSTEM_UNIT" || -L "$SYSTEM_UNIT" ]]; then REMOVE_SYSTEM=1; fi
fi
if [[ "$SERVICE_MODE" == user || "$SERVICE_MODE" == auto ]]; then
  if [[ -e "$USER_UNIT" || -L "$USER_UNIT" ]]; then REMOVE_USER=1; fi
fi
if (( REMOVE_SYSTEM || REMOVE_USER )); then
  command -v systemctl >/dev/null 2>&1 || die 'systemctl is required to stop the installed service before deleting data.'
fi

printf 'Uninstalling from: %s\n' "$APP_DIR"
(( ! REMOVE_SYSTEM )) || printf 'Remove system service: %s\n' "$SYSTEM_UNIT"
(( ! REMOVE_USER )) || printf 'Remove user service: %s\n' "$USER_UNIT"
printf 'Permanently delete:\n'
for entry in data Saves logs tmp config.json node_modules; do
  printf '  %s/%s\n' "$APP_DIR" "$entry"
done
if (( DISABLE_LINGER )); then
  printf 'Also disable user lingering; other user services may stop running after logout.\n'
fi
if (( ! DRY_RUN && ! ASSUME_YES )); then
  [[ -t 0 ]] || die 'Use --yes to confirm deletion, or --dry-run to preview.'
  read -r -p 'Remove the listed services and permanently delete these files? [y/N] ' reply || reply=''
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf 'Cancelled.\n'; exit 0; }
fi

# Abort on stop/disable failures: never delete data while the service may run.
if (( REMOVE_SYSTEM )); then
  run as_root systemctl stop "$UNIT"
  run as_root systemctl disable "$UNIT"
  run as_root rm -f -- "$SYSTEM_UNIT"
  run as_root systemctl daemon-reload
fi
if (( REMOVE_USER )); then
  run systemctl --user stop "$UNIT"
  run systemctl --user disable "$UNIT"
  run rm -f -- "$USER_UNIT"
  run systemctl --user daemon-reload
fi
if (( DISABLE_LINGER )); then
  run as_root loginctl disable-linger "$(id -un)"
fi

# Fixed direct children only. rm removes symlinks themselves, not their targets.
for entry in data Saves logs tmp config.json node_modules; do
  run rm -rf -- "$APP_DIR/$entry"
done
if (( DRY_RUN )); then
  printf 'Dry run complete; nothing changed.\n'
else
  printf 'Uninstall complete. Source checkout and shared system packages kept.\n'
fi
