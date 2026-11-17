#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "
SELECT id, \"tenantId\", provider, status, counts, error, \"startedAt\", \"finishedAt\"
FROM \"ExternalSyncRun\"
WHERE \"tenantId\" = '708fec3c-dc54-4a8f-ac4d-64bb91e42501'
ORDER BY \"startedAt\" DESC
LIMIT 4;
"

