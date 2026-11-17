#!/bin/bash
sudo -u postgres psql -d uyushma -c "
SELECT id, \"tenantId\", provider, status, (\"credentialsEncrypted\" IS NOT NULL) AS has_creds, (\"tokenEncrypted\" IS NOT NULL) AS has_token FROM \"ExternalConnection\";
"
