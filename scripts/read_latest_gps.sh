#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "SELECT * FROM gps_logs ORDER BY time DESC LIMIT 2;"

