#!/bin/bash
echo "=== 1. Check gps_logs in database ==="
sudo -u postgres psql -d uyushma -c "SELECT count(*) FROM gps_logs;"
sudo -u postgres psql -d uyushma -x -c "SELECT * FROM gps_logs ORDER BY recorded_at DESC LIMIT 3;"

echo "=== 2. Check vehicles with latest GPS updates ==="
sudo -u postgres psql -d uyushma -c "SELECT plate_number, virtual_gps_id, last_gps_time, last_latitude, last_longitude, last_speed_kmh, status FROM vehicles WHERE last_gps_time IS NOT NULL ORDER BY last_gps_time DESC LIMIT 5;"

echo "=== 3. Check BullMQ Worker Logs ==="
journalctl -u uyushma-worker -n 25 --no-pager

