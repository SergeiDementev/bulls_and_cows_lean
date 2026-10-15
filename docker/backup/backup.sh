#!/usr/bin/env bash
# A copy of the whole database to Object Storage, kept 7 days (docs/deploy.md, «Копии»).
# cron: 30 0 * * *   Log: logs/backup.log; a failure leaves an ERROR line with the step name.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
start_log backup.log
check_tools

NAME="${PREFIX}$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

STEP=dump
log "pg_dump $DB"
dump_to "$WORK/$NAME"

STEP=verify
verify_dump "$WORK/$NAME"
SIZE="$(stat -c %s "$WORK/$NAME")"
log "complete, $SIZE bytes"

STEP=upload
storage_put "$WORK/$NAME" "$NAME"
STORED="$(storage_size "$NAME")"
[[ "$STORED" == "$SIZE" ]] || { log "ERROR: $STORED bytes in storage, $SIZE expected"; exit 1; }
log "uploaded as $NAME"

STEP=rotate
CUTOFF="${PREFIX}$(date -u -d "-$KEEP_DAYS days" +%Y%m%dT%H%M%SZ)"
# Names carry the time, so comparing them as text compares the dates
for OLD in $(storage_list); do
  if [[ "$OLD" < "$CUTOFF" ]]; then
    storage_delete "$OLD"
    log "deleted $OLD"
  fi
done

STEP=done
log "backup complete: $NAME"
