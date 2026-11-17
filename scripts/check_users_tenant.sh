#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SELECT id, \"tenantId\", email, phone, role, \"fullName\" FROM \"User\";
"

