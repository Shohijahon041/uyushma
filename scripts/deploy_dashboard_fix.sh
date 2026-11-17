#!/usr/bin/env bash
set -e

echo "=== Pulling latest changes from Git ==="
cd /opt/uyushma/app
git pull origin main

echo "=== Building NestJS API ==="
cd /opt/uyushma/app/apps/api
npm run build
chown -R uyushma:uyushma dist

echo "=== Ensuring Next.js Standalone Static & Public Assets ==="
cd /opt/uyushma/app/apps/web
cp -ru public .next/standalone/apps/web/
cp -ru .next/static .next/standalone/apps/web/.next/
chown -R uyushma:uyushma .next

echo "=== Restarting Services ==="
systemctl restart uyushma-api
systemctl restart uyushma-web

echo "=== Verifying Service Status ==="
echo "uyushma-api: $(systemctl is-active uyushma-api)"
echo "uyushma-web: $(systemctl is-active uyushma-web)"
echo "uyushma-gps-api: $(systemctl is-active uyushma-gps-api)"
echo "uyushma-h02: $(systemctl is-active uyushma-h02)"

echo "=== All services restarted successfully ==="

