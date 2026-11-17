#!/usr/bin/env bash
set -e

CRON_CMD="5 0 * * * /opt/uyushma/app/collector_service/.venv/bin/python /opt/uyushma/app/collector_service/scripts/daily_billing_daemon.py >> /opt/uyushma/app/collector_service/logs/cron_billing.log 2>&1"

mkdir -p /opt/uyushma/app/collector_service/logs

# Check if cron already exists
CURRENT_CRON=$(crontab -l 2>/dev/null || true)
if echo "$CURRENT_CRON" | grep -q "daily_billing_daemon.py"; then
    echo "Billing cron job already exists."
else
    (echo "$CURRENT_CRON"; echo "$CRON_CMD") | crontab -
    echo "Billing cron job successfully installed."
fi

crontab -l | grep -i "billing"
