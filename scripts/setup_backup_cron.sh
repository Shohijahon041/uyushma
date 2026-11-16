#!/usr/bin/env bash
set -e

BACKUP_DIR="/opt/uyushma/backups"
SCRIPTS_DIR="/opt/uyushma/scripts"
mkdir -p "$BACKUP_DIR"
mkdir -p "$SCRIPTS_DIR"

BACKUP_SCRIPT="$SCRIPTS_DIR/backup_db.sh"
cat << 'EOF' > "$BACKUP_SCRIPT"
#!/usr/bin/env bash
set -e

BACKUP_DIR="/opt/uyushma/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/uyushma_backup_$TIMESTAMP.sql.gz"

# 1. PostgreSQL bazasini arxivlash (siqilgan holda)
sudo -u postgres pg_dump uyushma | gzip > "$FILENAME"

# 2. Xavfsiz ruxsatlar (faqat root/postgres o'qishi mumkin)
chmod 600 "$FILENAME"

# 3. 14 kundan eski arxivlarni avtomatik tozalash
find "$BACKUP_DIR" -type f -name "uyushma_backup_*.sql.gz" -mtime +14 -exec rm {} \;

echo "[BACKUP-SUCCESS] Baza zaxiralandi: $FILENAME ($(du -h "$FILENAME" | cut -f1))"
EOF

chmod +x "$BACKUP_SCRIPT"

# Cron vazifasini tekshirish va qo'shish (har kuni kechasi 03:00 da)
CRON_JOB="0 3 * * * /opt/uyushma/scripts/backup_db.sh >> /var/log/uyushma_backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "backup_db.sh" ; echo "$CRON_JOB") | crontab -

echo "✓ Zaxira skripti yaratildi va har kuni 03:00 ga crontab ga ulandi:"
crontab -l | grep "backup_db.sh"

# Zaxira skriptini darhol 1 marta sinab ko'rish
bash "$BACKUP_SCRIPT"
ls -lh "$BACKUP_DIR"
