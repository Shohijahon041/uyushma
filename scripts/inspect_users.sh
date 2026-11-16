#!/usr/bin/env bash
set -e
echo "=== users table ==="
sudo -u postgres psql -d uyushma -c "SELECT id, phone, role, full_name, telegram_chat_id FROM users;"
echo "=== \"User\" table ==="
sudo -u postgres psql -d uyushma -c "SELECT id, email, role, \"tenantId\" FROM \"User\";"
