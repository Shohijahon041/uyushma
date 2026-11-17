#!/bin/bash
mkdir -p /opt/uyushma/app/collector_service/logs

# O'rnatilgan cronlarni olish
(crontab -l 2>/dev/null | grep -v "hybrid_state_sync.py" || true) > /tmp/current_cron

# Yangi hybrid state sync cronlarini qo'shish
echo "0 2 * * * /opt/uyushma/app/collector_service/.venv/bin/python /opt/uyushma/app/collector_service/scripts/hybrid_state_sync.py --deep >> /opt/uyushma/app/collector_service/logs/cron_deep.log 2>&1" >> /tmp/current_cron
echo "0 */4 * * * /opt/uyushma/app/collector_service/.venv/bin/python /opt/uyushma/app/collector_service/scripts/hybrid_state_sync.py --delta >> /opt/uyushma/app/collector_service/logs/cron_delta.log 2>&1" >> /tmp/current_cron

crontab /tmp/current_cron
rm /tmp/current_cron

echo "=== Current active crontab ==="
crontab -l
