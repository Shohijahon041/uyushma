#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SET app.tenant_id = '708fec3c-dc54-4a8f-ac4d-64bb91e42501';
SELECT id, \"tenantId\", role, \"fullName\" FROM \"User\" WHERE role IN ('OWNER', 'ADMIN');
"

