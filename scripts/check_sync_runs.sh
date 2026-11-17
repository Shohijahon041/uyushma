#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "
SELECT id, \"tenantId\", provider, status, counts, error, \"startedAt\", \"finishedAt\"
FROM \"ExternalSyncRun\"
ORDER BY \"startedAt\" DESC
LIMIT 3;
"
