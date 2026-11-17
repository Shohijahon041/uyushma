#!/bin/bash
set -e
cd /opt/uyushma/app
git pull origin main
cd apps/api
npm run build
systemctl restart uyushma-api
systemctl status uyushma-api --no-pager

