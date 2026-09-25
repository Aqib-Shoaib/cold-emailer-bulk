#!/bin/sh
set -eu
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${BACKUP_FILE:?Set BACKUP_FILE}"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" >/dev/null
echo "Backup verified: $BACKUP_FILE"
