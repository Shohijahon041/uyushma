#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "SELECT id, \"tenantId\", provider, status, \"accountName\", \"expiresAt\", \"updatedAt\" FROM \"ExternalConnection\";"

