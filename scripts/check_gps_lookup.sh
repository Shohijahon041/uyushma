#!/bin/bash
sudo -u postgres psql -d uyushma -c "SELECT id, plate_number, virtual_gps_id, tenant_id FROM vehicles WHERE virtual_gps_id = '9170200908';"

