#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a disposable non-production database}"
: "${BACKUP_FILE:?Set BACKUP_FILE}"
if [ "${DATABASE_URL:-}" = "$RESTORE_DATABASE_URL" ]; then
  echo "Refusing to restore over DATABASE_URL" >&2
  exit 1
fi
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner "$BACKUP_FILE"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT COUNT(*) AS applied_migrations FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM jobs j LEFT JOIN campaigns c ON c.id = j.campaign_id WHERE c.id IS NULL) THEN
    RAISE EXCEPTION 'orphaned jobs found';
  END IF;
  IF EXISTS (SELECT 1 FROM email_messages e LEFT JOIN campaigns c ON c.id = e.campaign_id WHERE c.id IS NULL) THEN
    RAISE EXCEPTION 'orphaned email messages found';
  END IF;
END $$;
SQL
echo "Restore integrity check passed"
