#!/bin/bash
set -e
cd /opt/uyushma/app
git pull origin main
cd apps/web
npm run build
echo "Copying static assets and public directory to standalone..."
cp -ru public .next/standalone/apps/web/
cp -ru .next/static .next/standalone/apps/web/.next/
chown -R uyushma:uyushma .next
systemctl restart uyushma-web
systemctl status uyushma-web --no-pager
