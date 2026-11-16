#!/bin/bash
sudo -u postgres psql -d uyushma -c "SELECT id, plate_number, virtual_gps_id FROM vehicles WHERE virtual_gps_id = '9170121311' OR plate_number = '60A125UA';"
