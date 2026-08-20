#!/bin/bash
set -e
BACKUP_DIR="/opt/backups"
DATE=$(date +%F_%H-%M)
docker exec trinkduell-db pg_dump -U trinkduell_user trinkduell > "$BACKUP_DIR/trinkduell_$DATE.sql"
# Alte Backups löschen, die älter als 14 Tage sind
find "$BACKUP_DIR" -name "trinkduell_*.sql" -mtime +14 -delete
