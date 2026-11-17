#!/bin/bash
echo "=== Check Driver Shohijahon ==="
sudo -u postgres psql -d uyushma -x -c "SELECT id, \"tenantId\", \"fullName\", phone, status FROM \"Driver\" WHERE phone = '+998911278902';"

echo "=== Check Vehicle for Shohijahon in vehicles and Vehicle ==="
sudo -u postgres psql -d uyushma -x -c "SELECT v.id, v.plate_number, v.virtual_gps_id, v.current_driver_id, d.\"fullName\", d.phone FROM vehicles v JOIN \"Driver\" d ON d.id = v.current_driver_id WHERE d.phone = '+998911278902';"

echo "=== Check Waybills for Shohijahon ==="
sudo -u postgres psql -d uyushma -x -c "SELECT w.id, w.number, w.status, w.date, w.\"validUntil\", w.\"publicToken\", w.\"medicalPassed\", w.\"technicalPassed\" FROM \"Waybill\" w JOIN \"Driver\" d ON d.id = w.\"driverId\" WHERE d.phone = '+998911278902' ORDER BY w.date DESC LIMIT 3;"

