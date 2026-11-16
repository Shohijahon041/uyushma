#!/bin/bash
sudo -u postgres psql -d uyushma -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Vehicle';"
