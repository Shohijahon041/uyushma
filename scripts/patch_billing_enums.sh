#!/usr/bin/env bash
set -e
sudo -u postgres psql -d uyushma -c "ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'SYSTEM';"
sudo -u postgres psql -d uyushma -c "ALTER TYPE \"DriverPaymentMethod\" ADD VALUE IF NOT EXISTS 'ONLINE';"
echo "Payment enums patched successfully!"
