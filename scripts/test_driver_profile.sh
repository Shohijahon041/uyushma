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
    "http://127.0.0.1:8020/api/v1/driver/profile",
    headers={"Authorization": f"Bearer {token}"}
)
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        print("=== DRIVER PROFILE RESULT ===")
        print(f"Has vehicle: {data.get('has_vehicle')}")
        print(f"Driver Name: {data.get('driver', {}).get('full_name')}")
        print(f"Driver Phone: {data.get('driver', {}).get('phone')}")
        print(f"Driver Photo: {data.get('driver', {}).get('photo_url')}")
        print(f"Vehicle Plate: {data.get('vehicle', {}).get('plate_number')}")
        print(f"Vehicle Model: {data.get('vehicle', {}).get('model')}")
        print(f"Virtual GPS ID: {data.get('vehicle', {}).get('virtual_gps_id')}")
        print(f"Waybill Number: {data.get('waybill', {}).get('number')}")
        print(f"Waybill Verify URL: {data.get('waybill', {}).get('public_verification_url')}")
except Exception as e:
    print(f"Error: {e}")
EOF
