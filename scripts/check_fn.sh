#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SELECT pg_get_functiondef('app_current_tenant_id'::regproc);
"

