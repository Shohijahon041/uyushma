#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SELECT conname, pg_get_constraintdef(c.oid) 
FROM pg_constraint c 
JOIN pg_class t ON c.conrelid = t.oid 
WHERE t.relname = 'Vehicle';
"

