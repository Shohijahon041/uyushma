#!/bin/bash
python3 - << 'EOF'
with open('/etc/nginx/sites-enabled/uyushma.conf', 'r') as f:
    content = f.read()

target = "    location /waybill/ {"
replacement = """    location /uyushma-haydovchi.apk {
        alias /opt/uyushma/uploads/uyushma-haydovchi.apk;
        add_header Content-Disposition 'attachment; filename="uyushma-haydovchi.apk"';
        add_header Content-Type 'application/vnd.android.package-archive';
    }

    location /waybill/ {"""

if target in content and "location /uyushma-haydovchi.apk {" not in content:
    content = content.replace(target, replacement, 1)
    with open('/etc/nginx/sites-enabled/uyushma.conf', 'w') as f:
        f.write(content)
    print("Nginx configuration successfully updated with /uyushma-haydovchi.apk!")
else:
    print("Already present or target not found.")
EOF
nginx -t && systemctl reload nginx
