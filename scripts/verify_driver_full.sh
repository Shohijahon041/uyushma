#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "
SELECT id, \"fullName\", phone, \"licenseNumber\", \"licenseExpiresAt\"
FROM \"Driver\"
WHERE phone LIKE '%911278902%';
"

sudo -u postgres psql -d uyushma -x -c "
SELECT id, \"plateNumber\", model, capacity, status, \"tenantId\"
FROM \"Vehicle\"
WHERE \"plateNumber\" = '60A125UA';
"

sudo -u postgres psql -d uyushma -x -c "
SELECT id, \"plateNumber\", provider, status, \"externalId\"
FROM \"ExternalVehicle\"
WHERE \"plateNumber\" = '60A125UA';
"

sudo -u postgres psql -d uyushma -x -c "
SELECT id, provider, kind, number, title, \"startsAt\", \"endsAt\"
FROM \"ExternalRecord\"
WHERE number LIKE '%60A125UA%' OR raw::text LIKE '%60A125UA%'
LIMIT 3;
"

