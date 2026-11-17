#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "SELECT id, \"tenantId\", provider, status, \"baseUrl\", \"lastSyncAt\", \"lastError\", \"lastLoginAt\" FROM \"ExternalConnection\";"

