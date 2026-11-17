#!/bin/bash
psql "postgresql://uyushma_app:d0b7410e63d2b0d2dc5beb09672fcbac30ef@127.0.0.1:5432/uyushma" -c "
SET app.tenant_id = '708fec3c-dc54-4a8f-ac4d-64bb91e42501';
SELECT id, \"tenantId\", role, \"fullName\" FROM \"User\" WHERE role IN ('OWNER', 'ADMIN') ORDER BY role ASC, \"createdAt\" ASC;
"

