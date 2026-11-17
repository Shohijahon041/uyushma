#!/bin/bash
/opt/uyushma/venv-gps/bin/python - << 'EOF'
import jwt, datetime, urllib.request, json

JWT_SECRET = "super-secret-uyushma-jwt-key-2026-production"
JWT_ALGORITHM = "HS256"

payload = {
    "user_id": "06b58bb0-3aef-4b1d-85a4-817b83065d8b",
    "phone": "+998911278902",
    "role": "DRIVER",
    "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
}
token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

req = urllib.request.Request(
    "http://127.0.0.1:8020/api/v1/driver/waybill",
    headers={"Authorization": f"Bearer {token}"}
)
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        print("=== DRIVER WAYBILL RESULT ===")
        print(f"Waybill Number: {data.get('number')}")
        print(f"Status: {data.get('status')}")
        print(f"Medical: {data.get('medical_passed')}, Doc: {data.get('medical_doctor')}")
        print(f"Technical: {data.get('technical_passed')}, Mech: {data.get('mechanic_name')}")
        print(f"Public Token: {data.get('public_token')}")
        print(f"Verification URL: {data.get('verification_url')}")
except Exception as e:
    print(f"Error: {e}")
EOF

