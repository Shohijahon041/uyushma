#!/bin/bash
sudo -u postgres psql -d uyushma -t -A -c "SELECT \"credentialsEncrypted\" FROM \"ExternalConnection\" WHERE \"credentialsEncrypted\" IS NOT NULL LIMIT 1;"

