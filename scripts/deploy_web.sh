#!/bin/bash
set -e
cd /opt/uyushma/app
git pull origin main
cd apps/web
npm run build
systemctl restart uyushma-web
systemctl status uyushma-web --no-pager

