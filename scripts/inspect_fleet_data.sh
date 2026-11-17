#!/usr/bin/env bash
set -e

echo "=== Total Vehicle rows in \"Vehicle\": ==="
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM "Vehicle";'

echo "=== Total assignments in \"VehicleAssignment\": ==="
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM "VehicleAssignment";'

echo "=== Active assignments (\"endDate\" IS NULL): ==="
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM "VehicleAssignment" WHERE "endDate" IS NULL;'

echo "=== Sample 5 vehicles from \"Vehicle\": ==="
sudo -u postgres psql -d uyushma -c 'SELECT id, "tenantId", "plateNumber", model, "monthlyFee" FROM "Vehicle" LIMIT 5;'

