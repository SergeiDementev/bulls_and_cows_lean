# Shared by backup.sh and restore.sh (docs/deploy.md, «Копии»). Sourced, not run.
#
# Storage: oci — Oracle Object Storage, the VM signs in as itself (instance principal), no keys
# on disk; local — a folder (BACKUP_LOCAL_DIR), to check the whole path without Oracle.

set -Eeuo pipefail
# cron starts scripts with a bare PATH
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
LOG_DIR="$PROJECT_DIR/logs"
PREFIX="bulls_lean_"
KEEP_DAYS=7

env_value() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }

STORAGE="${BACKUP_STORAGE:-oci}"
OCI_BIN="${OCI_BIN:-$HOME/.oci-cli-venv/bin/oci}"
OCI_BUCKET="${OCI_BUCKET:-bulls-and-cows-backups}"
OCI_NAMESPACE="${OCI_NAMESPACE:-$(env_value OCI_NAMESPACE)}"
DB="$(env_value POSTGRES_DB)"

compose() { docker compose -f "$PROJECT_DIR/docker/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }

STEP=start
log() { echo "$(date -u '+%F %T UTC') [$STEP] $*"; }
trap 'log "ERROR: step failed (exit $?)"' ERR

# Into logs/<file>; also on screen when run by hand
start_log() {
  mkdir -p "$LOG_DIR"
  if [[ -t 1 ]]; then exec > >(tee -a "$LOG_DIR/$1") 2>&1; else exec >>"$LOG_DIR/$1" 2>&1; fi
}

check_tools() {
  [[ -f "$ENV_FILE" ]] || { log "ERROR: no settings file $ENV_FILE"; exit 1; }
  [[ -n "$DB" ]] || { log "ERROR: POSTGRES_DB is not set in $ENV_FILE"; exit 1; }
  case "$STORAGE" in
    oci)
      [[ -x "$OCI_BIN" ]] || { log "ERROR: oci not found at $OCI_BIN"; exit 1; }
      [[ -n "$OCI_NAMESPACE" ]] || { log "ERROR: OCI_NAMESPACE is not set"; exit 1; }
      ;;
    local) mkdir -p "${BACKUP_LOCAL_DIR:?BACKUP_LOCAL_DIR is not set}" ;;
    *) log "ERROR: unknown BACKUP_STORAGE=$STORAGE (oci or local)"; exit 1 ;;
  esac
}

dump_to() { # <file>: the whole database; --clean lets a restore replace what is there
  compose exec -T db pg_dump -U postgres --clean --if-exists "$DB" | gzip >"$1"
}

# The archive is intact and pg_dump wrote it to the end: its last lines carry a marker
verify_dump() {
  gzip -t "$1"
  gzip -dc "$1" | tail -n 5 | grep -q "PostgreSQL database dump complete" \
    || { log "ERROR: $1 is incomplete: no end-of-dump marker"; return 1; }
}

oci_os() {
  "$OCI_BIN" os object "$@" --auth instance_principal --bucket-name "$OCI_BUCKET" --namespace "$OCI_NAMESPACE"
}

storage_put() { # <file> <name>
  case "$STORAGE" in
    oci) oci_os put --file "$1" --name "$2" --force >/dev/null ;;
    local) cp "$1" "$BACKUP_LOCAL_DIR/$2" ;;
  esac
}

storage_size() { # <name> → bytes
  case "$STORAGE" in
    oci) oci_os head --name "$1" --query '"content-length"' --raw-output ;;
    local) stat -c %s "$BACKUP_LOCAL_DIR/$1" ;;
  esac
}

storage_list() { # → names, oldest first
  case "$STORAGE" in
    oci) oci_os list --prefix "$PREFIX" --all --query 'data[].name' --raw-output | tr -d '[]", ' | grep -v '^$' | sort || true ;;
    local) find "$BACKUP_LOCAL_DIR" -maxdepth 1 -name "${PREFIX}*.sql.gz" -printf '%f\n' | sort ;;
  esac
}

storage_get() { # <name> <file>
  case "$STORAGE" in
    oci) oci_os get --name "$1" --file "$2" >/dev/null ;;
    local) cp "$BACKUP_LOCAL_DIR/$1" "$2" ;;
  esac
}

storage_delete() { # <name>
  case "$STORAGE" in
    oci) oci_os delete --name "$1" --force >/dev/null ;;
    local) rm -f "$BACKUP_LOCAL_DIR/$1" ;;
  esac
}
