#!/bin/bash
mkdir -p /var/www/html
cp /opt/uyushma/uploads/uyushma-haydovchi.apk /var/www/html/uyushma-haydovchi.apk
chmod 644 /var/www/html/uyushma-haydovchi.apk
chown www-data:www-data /var/www/html/uyushma-haydovchi.apk

sed -i 's|/opt/uyushma/uploads/uyushma-haydovchi.apk|/var/www/html/uyushma-haydovchi.apk|g' /etc/nginx/sites-enabled/uyushma.conf
nginx -t && systemctl reload nginx
ls -lh /var/www/html/uyushma-haydovchi.apk
