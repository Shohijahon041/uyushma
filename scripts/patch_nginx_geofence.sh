#!/usr/bin/env bash
set -e

CONF="/etc/nginx/sites-enabled/uyushma.conf"
cp "$CONF" "${CONF}.bak_$(date +%s)"

# Check if /api/v1/routes/ already exists
if grep -q "location /api/v1/routes/" "$CONF"; then
    echo "Routes location block already present in $CONF"
else
    # Insert before location /api/ {
    sed -i '/location \/api\/ {/i \
    location /api/v1/routes/ {\
        proxy_pass http://127.0.0.1:8020;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
    }\
\
    location /api/v1/alerts {\
        proxy_pass http://127.0.0.1:8020;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
    }\
\
    location /health {\
        proxy_pass http://127.0.0.1:8020/health;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
    }\
' "$CONF"
    echo "Inserted routes, alerts, and health blocks."
fi

nginx -t
systemctl reload nginx
echo "Nginx successfully reloaded!"

