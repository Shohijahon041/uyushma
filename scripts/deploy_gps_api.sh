#!/bin/bash
cd /opt/uyushma/app
git pull origin main
systemctl restart uyushma-gps-api
sleep 2
systemctl status uyushma-gps-api --no-pager
