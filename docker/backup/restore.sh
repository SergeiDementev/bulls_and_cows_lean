#!/usr/bin/env bash
# Replaces the database with a copy (docs/deploy.md, «Восстановление»).
#   restore.sh                  list the copies
#   restore.sh [--yes] <copy>   restore; asks first unless --yes
# The current database is saved to logs/ first, in case the wrong copy was chosen.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
start_log restore.log
check_tools

YES=false
if [[ "${1:-}" == "--yes" ]]; then YES=true; shift; fi
if [[ $# -eq 0 ]]; then
  STEP=list
  storage_list
  exit 0
fi
NAME="$1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

STEP=download
storage_get "$NAME" "$WORK/$NAME"
verify_dump "$WORK/$NAME"
log "$NAME downloaded and complete"

if ! $YES; then
  read -r -p "Replace database '$DB' with $NAME? [y/N] " ANSWER
  [[ "$ANSWER" == "y" ]] || { log "cancelled"; exit 1; }
fi

STEP=save-current
SAVED="$LOG_DIR/before-restore-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
dump_to "$SAVED"
chmod 600 "$SAVED"
log "current database saved to $SAVED"

STEP=stop-app
compose stop app
# Whatever fails from here on, the game comes back up: the restore is one transaction, so on a
# failure the database is still the old one
trap 'rm -rf "$WORK"; [[ "$STEP" == done ]] || { log "starting the app again"; compose up -d --wait app; }' EXIT

STEP=restore
# One transaction: if anything fails, the database stays as it was
gzip -dc "$WORK/$NAME" | compose exec -T db psql -q -v ON_ERROR_STOP=1 -1 -U postgres -d "$DB" >/dev/null
log "restored"

STEP=start-app
compose up -d --wait app

STEP=done
log "restore complete: $NAME"
