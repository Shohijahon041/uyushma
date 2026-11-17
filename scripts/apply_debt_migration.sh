#!/usr/bin/env bash
set -e
sudo -u postgres psql -d uyushma -c "ALTER TYPE \"AlertType\" ADD VALUE IF NOT EXISTS 'FINANCIAL_DEBT';"
echo "Enum AlertType altered with FINANCIAL_DEBT successfully!"
