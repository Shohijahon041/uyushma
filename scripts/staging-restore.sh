#!/usr/bin/env bash
# Staging bazasini WAL-G base backup'dan tiklaydi (ixtiyoriy PITR vaqti bilan).
# Foydalanish: ./scripts/staging-restore.sh ["2026-10-30 12:00:00+00"]
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.staging ]; then
  echo ".env.staging topilmadi" >&2
  exit 1
fi

COMPOSE=(docker compose --env-file .env.staging -f docker-compose.staging.yml)
PROJECT=uyushmachilar-staging
IMAGE="${PROJECT}-postgres"

set -a
# shellcheck disable=SC1091
. ./.env.staging
set +a

TARGET="${1:-}"

echo "DIQQAT: joriy staging bazasi oxirgi base backup bilan almashtiriladi."
if [ -n "$TARGET" ]; then
  echo "PITR maqsad vaqti: $TARGET"
fi
echo "Bekor qilish uchun 10 soniya ichida Ctrl+C bosing."
sleep 10

"${COMPOSE[@]}" stop api worker bot web caddy postgres

docker run --rm --user postgres --network "${PROJECT}_backend" \
  -e PGDATA=/var/lib/postgresql/data \
  -e WALG_S3_PREFIX="s3://${BACKUP_BUCKET}/wal" \
  -e AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER" \
  -e AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
  -e AWS_ENDPOINT=http://minio:9000 \
  -e AWS_REGION=us-east-1 \
  -e AWS_S3_FORCE_PATH_STYLE=true \
  -v "${PROJECT}_pgdata:/var/lib/postgresql/data" \
  "$IMAGE" \
  sh -c 'rm -rf "$PGDATA"/* && wal-g backup-fetch "$PGDATA" LATEST'

docker run --rm --user postgres \
  -e PGDATA=/var/lib/postgresql/data \
  -v "${PROJECT}_pgdata:/var/lib/postgresql/data" \
  "$IMAGE" sh -s <<EOF
set -eu
touch "\$PGDATA/recovery.signal"
{
  echo "restore_command = 'wal-g wal-fetch %f %p'"
  echo "recovery_target_action = 'promote'"
  ${TARGET:+echo "recovery_target_time = '$TARGET'"}
} >> "\$PGDATA/postgresql.auto.conf"
EOF

"${COMPOSE[@]}" up -d postgres
echo "PostgreSQL tiklanmoqda. Holat: docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f postgres"
echo "Tayyor bo'lgach: npm run staging:up"
