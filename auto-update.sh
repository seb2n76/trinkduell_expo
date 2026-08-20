#!/bin/bash
set -e
cd /opt/trinkduell

LOG_FILE="/var/log/trinkduell-update.log"
echo "[$(date)] Checking for updates..." >> "$LOG_FILE"

OLD_COMMIT=$(git rev-parse HEAD)
git pull >> "$LOG_FILE" 2>&1
NEW_COMMIT=$(git rev-parse HEAD)

if [ "$OLD_COMMIT" != "$NEW_COMMIT" ]; then
  echo "[$(date)] Update found ($OLD_COMMIT -> $NEW_COMMIT), rebuilding..." >> "$LOG_FILE"
  docker compose -f server/docker-compose.yml up -d --build >> "$LOG_FILE" 2>&1
  echo "[$(date)] Rebuild complete." >> "$LOG_FILE"
else
  echo "[$(date)] No changes." >> "$LOG_FILE"
fi
