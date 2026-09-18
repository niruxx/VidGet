#!/usr/bin/env bash
#
# Vidget updater for Linux.
#
# Fast-forwards this checkout to the latest commit of its upstream branch,
# reinstalls npm dependencies when they changed, and restarts the systemd
# service if one is installed.
#
# User data is never touched:
#   - Saves/, logs/ and tmp/ are git-ignored, so git leaves them alone.
#   - config.json is tracked by git, so it is backed up and restored around
#     the update (your local edits always win).
#   - Local edits to any other tracked file abort the update instead of being
#     overwritten.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_NAME="vidget"
NO_RESTART=0
FORCE_DEPS=0
REFRESH_YTDLP=0
CHECK_ONLY=0
CONFIG_BACKUP=""

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
Usage: ./update.sh [options]

Updates Vidget to the latest git commit without touching Saves/, logs/, tmp/
or your config.json.

Options:
  --check           Only report whether an update is available
  --no-restart      Do not restart the systemd service afterwards
  --reinstall-deps  Reinstall npm dependencies even if package files did not change
  --refresh-ytdlp   Re-download the latest yt-dlp binary (YouTube changes often)
  --name NAME       systemd service name (default: ${SERVICE_NAME})
  -h, --help        Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check)          CHECK_ONLY=1 ;;
      --no-restart)     NO_RESTART=1 ;;
      --reinstall-deps) FORCE_DEPS=1 ;;
      --refresh-ytdlp)  REFRESH_YTDLP=1 ;;
      --name)           [[ $# -ge 2 ]] || die "--name needs a value"; SERVICE_NAME="$2"; shift ;;
      -h|--help)        usage; exit 0 ;;
      *)                usage >&2; die "Unknown option: $1" ;;
    esac
    shift
  done
}

restore_config() {
  if [[ -n "$CONFIG_BACKUP" && -f "$CONFIG_BACKUP" ]]; then
    cp -p "$CONFIG_BACKUP" "$APP_DIR/config.json"
    rm -f "$CONFIG_BACKUP"
    CONFIG_BACKUP=""
    log "Restored your config.json"
  fi
}
trap restore_config EXIT

config_is_modified() {
  git ls-files --error-unmatch config.json >/dev/null 2>&1 \
    && [[ -f config.json ]] \
    && ! git diff --quiet HEAD -- config.json
}

# yt-dlp-exec's npm preinstall needs a `python` command; provide a temporary
# shim on distros that only ship python3.
npm_install_deps() {
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
  [[ $rc -eq 0 ]] || die "npm install failed (exit $rc). Your code is updated; fix the error and run: ./update.sh --reinstall-deps"
}

restart_service() {
  if [[ $NO_RESTART -eq 1 ]]; then
    log "Skipping service restart (--no-restart)"
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not found; restart Vidget manually."
    return
  fi

  if systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
      log "Restarting system service ${SERVICE_NAME}"
      if [[ $EUID -eq 0 ]]; then
        systemctl restart "${SERVICE_NAME}.service"
      else
        sudo systemctl restart "${SERVICE_NAME}.service" || warn "Could not restart; run: sudo systemctl restart ${SERVICE_NAME}"
      fi
    else
      warn "Service ${SERVICE_NAME} is installed but not running. Start it with: sudo systemctl start ${SERVICE_NAME}"
    fi
  elif systemctl --user cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    if systemctl --user is-active --quiet "${SERVICE_NAME}.service"; then
      log "Restarting user service ${SERVICE_NAME}"
      systemctl --user restart "${SERVICE_NAME}.service" || warn "Could not restart; run: systemctl --user restart ${SERVICE_NAME}"
    else
      warn "User service ${SERVICE_NAME} is installed but not running. Start it with: systemctl --user start ${SERVICE_NAME}"
    fi
  else
    warn "No '${SERVICE_NAME}' systemd service found; restart Vidget manually if it is running."
  fi
}

main() {
  parse_args "$@"
  cd "$APP_DIR"

  command -v git >/dev/null 2>&1 || die "git is required."
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP_DIR is not a git checkout; cannot update."

  local branch remote upstream
  branch="$(git symbolic-ref --quiet --short HEAD)" || die "HEAD is detached; check out a branch first."
  remote="$(git config "branch.${branch}.remote")" || die "Branch '${branch}' has no upstream. Run: git branch --set-upstream-to=origin/${branch}"
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')" || die "Could not resolve upstream for '${branch}'."

  local dirty
  dirty="$(git status --porcelain --untracked-files=no | grep -Ev '^.. config\.json$' || true)"
  if [[ -n "$dirty" ]]; then
    printf '%s\n' "$dirty" >&2
    die "You have local changes to tracked files (listed above). Commit or stash them, then re-run."
  fi

  log "Checking ${upstream} for updates"
  git fetch --quiet "$remote" || die "git fetch failed (network problem?)."

  local old_head remote_head
  old_head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse '@{u}')"

  local up_to_date=0
  if [[ "$old_head" == "$remote_head" ]]; then
    up_to_date=1
  elif git merge-base --is-ancestor "$remote_head" "$old_head"; then
    warn "This checkout has local commits that are not on ${upstream}; nothing to pull."
    up_to_date=1
  elif ! git merge-base --is-ancestor "$old_head" "$remote_head"; then
    die "Your branch and ${upstream} have diverged; cannot fast-forward. Resolve manually (git pull --rebase)."
  fi

  if [[ $CHECK_ONLY -eq 1 ]]; then
    if [[ $up_to_date -eq 1 ]]; then
      log "Already up to date ($(git rev-parse --short HEAD))."
    else
      log "Update available: $(git rev-list --count "${old_head}..${remote_head}") new commit(s)."
      git log --oneline --no-decorate "${old_head}..${remote_head}"
    fi
    return
  fi

  if [[ $up_to_date -eq 1 ]]; then
    log "Already up to date ($(git rev-parse --short HEAD))."
    if [[ $FORCE_DEPS -eq 1 || $REFRESH_YTDLP -eq 1 ]]; then
      finish_steps "$old_head" 1
    fi
    return
  fi

  # Protect the user's config.json (tracked in git) from the merge.
  if config_is_modified; then
    CONFIG_BACKUP="$(mktemp)"
    cp -p config.json "$CONFIG_BACKUP"
    log "Backed up your config.json (temporary copy: ${CONFIG_BACKUP})"
    git checkout HEAD -- config.json
  fi

  log "Updating $(git rev-parse --short HEAD) -> $(git rev-parse --short "$remote_head")"
  git merge --ff-only --quiet "$upstream" || die "Fast-forward failed; nothing was changed except a temporary restore of config.json."
  restore_config

  echo
  git log --oneline --no-decorate "${old_head}..HEAD"
  echo

  finish_steps "$old_head" 0
}

# finish_steps OLD_HEAD SKIP_DIFF: reinstall deps if needed, refresh yt-dlp, restart.
finish_steps() {
  local old_head="$1" skip_diff="$2" need_deps=$FORCE_DEPS changed=""

  if [[ "$skip_diff" -eq 0 ]]; then
    changed="$(git diff --name-only "$old_head" HEAD)"
    if grep -Eq '^package(-lock)?\.json$' <<<"$changed"; then need_deps=1; fi
  fi
  [[ -d node_modules ]] || need_deps=1

  if [[ $need_deps -eq 1 ]]; then
    command -v npm >/dev/null 2>&1 || die "npm not found; cannot install dependencies."
    log "Installing npm dependencies"
    npm_install_deps
  else
    log "Dependencies unchanged"
  fi

  # A fresh `npm ci` already downloaded the newest yt-dlp.
  if [[ $REFRESH_YTDLP -eq 1 && $need_deps -eq 0 ]]; then
    log "Refreshing yt-dlp"
    node "$APP_DIR/node_modules/yt-dlp-exec/scripts/postinstall.js" || warn "yt-dlp refresh failed; the previous binary may still work."
  fi

  restart_service
  log "Done. Saves/, logs/, tmp/ and config.json were left untouched."
}

main "$@"
exit $?
