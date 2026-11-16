#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "
SELECT va.id, va.\"driverId\", va.\"vehicleId\", va.\"startDate\", va.\"endDate\", v.\"plateNumber\", v.model
FROM \"VehicleAssignment\" va
JOIN \"Vehicle\" v ON v.id = va.\"vehicleId\"
WHERE va.\"driverId\" = '15672774-dcb9-4d94-afd6-f6731c1fa0a0';
"
