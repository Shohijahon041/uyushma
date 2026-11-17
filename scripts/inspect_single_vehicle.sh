#!/usr/bin/env bash
set -e
sudo -u postgres psql -d uyushma -c "SELECT id, plate_number, model, virtual_gps_id, current_driver_id FROM vehicles;"

