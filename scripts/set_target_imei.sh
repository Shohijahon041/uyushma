#!/bin/bash
sudo -u postgres psql -d uyushma -c "UPDATE vehicles SET virtual_gps_id = '9170121311' WHERE plate_number = '60A125UA';"
sudo -u postgres psql -d uyushma -c "SELECT id, plate_number, virtual_gps_id FROM vehicles WHERE plate_number = '60A125UA';"
