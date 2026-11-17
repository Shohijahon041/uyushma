#!/usr/bin/env bash
set -e
echo "COUNT(vehicles):"
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM vehicles;'
echo "COUNT(\"Vehicle\"):"
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM "Vehicle";'

echo "COUNT(users):"
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM users;'
echo "COUNT(\"User\"):"
sudo -u postgres psql -d uyushma -c 'SELECT count(*) FROM "User";'

