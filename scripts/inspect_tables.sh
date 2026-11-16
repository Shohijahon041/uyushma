#!/usr/bin/env bash
sudo -u postgres psql -d uyushma -c "SELECT id, number, date, \"driverId\", \"vehicleId\", \"publicToken\" FROM \"Waybill\" LIMIT 5;"
