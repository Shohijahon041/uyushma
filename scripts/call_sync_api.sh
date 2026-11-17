#!/bin/bash
INTERNAL_KEY=$(grep '^INTERNAL_API_KEY=' /opt/uyushma/.env | cut -d '=' -f2 | tr -d '"'"'")
TENANT_ID="708fec3c-dc54-4a8f-ac4d-64bb91e42501"

for PROVIDER in "ETENDER" "IJARA" "AUTOPARK"; do
  echo "=== Calling sync for $PROVIDER ==="
  curl -s -X POST "http://127.0.0.1:4010/api/v1/internal/external/sync" \
    -H "Content-Type: application/json" \
    -H "x-internal-api-key: $INTERNAL_KEY" \
    -d "{\"tenantId\": \"$TENANT_ID\", \"provider\": \"$PROVIDER\"}"
  echo ""
done
