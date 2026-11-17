#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SELECT relname, relrowsecurity, relforcerowsecurity 
FROM pg_class 
WHERE relname IN ('Vehicle', 'Route', 'User', 'Company', 'ExternalVehicle', 'ExternalRecord');
"

