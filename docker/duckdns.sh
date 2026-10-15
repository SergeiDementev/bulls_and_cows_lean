#!/usr/bin/env bash
# Keeps the DuckDNS name pointing at this VM: its public IP changes when the VM restarts.
# cron: */5 * * * * and @reboot. Logs only changes and failures (logs/duckdns.log).
set -Eeuo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="$PROJECT_DIR/logs"
LAST="$LOG_DIR/duckdns.last-ip"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/duckdns.log" 2>&1
log() { echo "$(date -u '+%F %T UTC') $*"; }

env_value() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
DOMAIN="$(env_value DOMAIN)"
TOKEN="$(env_value DUCKDNS_TOKEN)"
[[ "$DOMAIN" == *.duckdns.org && -n "$TOKEN" ]] || { log "ERROR: DOMAIN or DUCKDNS_TOKEN not set"; exit 1; }

IP="$(curl -fsS --max-time 15 https://api.ipify.org)" || { log "ERROR: cannot learn the public IP"; exit 1; }
[[ "$IP" == "$(cat "$LAST" 2>/dev/null)" ]] && exit 0

# The token goes in the URL, so the URL itself is never logged
ANSWER="$(curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=${DOMAIN%.duckdns.org}&token=$TOKEN&ip=$IP")" \
  || { log "ERROR: DuckDNS did not answer"; exit 1; }
if [[ "$ANSWER" == "OK" ]]; then
  echo "$IP" >"$LAST"
  log "address now points to $IP"
else
  log "ERROR: DuckDNS refused the update ($ANSWER)"
  exit 1
fi
