#!/usr/bin/env bash
set -e

echo "=== 1. Driver ustunlari ==="
sudo -u postgres psql -d uyushma -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Driver';"

echo "=== 2. Vehicle ustunlari ==="
sudo -u postgres psql -d uyushma -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Vehicle';"

echo "=== 3. Driver yozuvlari ==="
sudo -u postgres psql -d uyushma -c "SELECT id, \"fullName\", phone, status, \"telegramChatId\" FROM \"Driver\";"

echo "=== 4. Vehicle yozuvlari ==="
sudo -u postgres psql -d uyushma -c "SELECT id, \"plateNumber\", model, status, \"virtualGpsId\" FROM \"Vehicle\";"
