#!/bin/bash
mkdir -p /opt/uyushma/app/collector_service/logs
CRON_LINE="*/30 * * * * /opt/uyushma/app/collector_service/.venv/bin/python /opt/uyushma/app/collector_service/scripts/auto_token_refresher.py >> /opt/uyushma/app/collector_service/logs/watchdog.log 2>&1"

(crontab -l 2>/dev/null | grep -v "auto_token_refresher.py"; echo "$CRON_LINE") | crontab -
echo "=== Yangi crontab ro'yxati ==="
crontab -l

