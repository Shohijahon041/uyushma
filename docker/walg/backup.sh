#!/bin/sh
# Kunlik base backup + WAL arxivlash (PITR). WAL-G MinIO'ga yozadi.
set -eu

if [ -z "${WALG_S3_PREFIX:-}" ]; then
  echo "[backup] WALG_S3_PREFIX berilmagan" >&2
  exit 1
fi

RETENTION="${BACKUP_RETENTION:-7}"

run_backup() {
  echo "[backup] $(date -u +%FT%TZ) base backup boshlandi"
  if wal-g backup-push "$PGDATA"; then
    echo "[backup] $(date -u +%FT%TZ) backup tugadi"
    wal-g delete retain FULL "$RETENTION" --confirm \
      || echo "[backup] retention tozalashda xato" >&2
    return 0
  fi
  echo "[backup] xato; 5 daqiqadan keyin qayta urinamiz" >&2
  return 1
}

until run_backup; do
  sleep 300
done

while true; do
  sleep 86400
  run_backup || sleep 300
done
