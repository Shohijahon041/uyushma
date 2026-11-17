#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SELECT polname, polrelid::regclass, polcmd, polqual, polwithcheck 
FROM pg_policy 
WHERE polrelid = '\"User\"'::regclass;
"

