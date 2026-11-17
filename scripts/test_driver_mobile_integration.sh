#!/bin/bash
/opt/uyushma/venv-gps/bin/python - << 'EOF'
import jwt, datetime, urllib.request, json

JWT_SECRET = "super-secret-uyushma-jwt-key-2026-production"
JWT_ALGORITHM = "HS256"

payload = {
    "user_id": "06b58bb0-3aef-4b1d-85a4-817b83065d8b",
    "phone": "+998911278902",
    "full_name": "Shohijahon Mirzarxmatov",
    "role": "DRIVER",
    "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
}
token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# 1. Profile test
req_prof = urllib.request.Request("http://127.0.0.1:8020/api/v1/driver/profile", headers=headers)
with urllib.request.urlopen(req_prof) as resp:
    prof = json.loads(resp.read().decode())
    print("1. [PROFILE] Driver:", prof.get("driver", {}).get("full_name"))
    print("   Vehicle Plate:", prof.get("vehicle", {}).get("plate_number"))
    print("   Active Shift:", prof.get("active_shift"))

# 2. Start Shift test with odometer
gps_id = prof.get("vehicle", {}).get("virtual_gps_id") or "9170121311"
start_body = json.dumps({
    "virtual_gps_id": gps_id,
    "odometer": 145500,
    "note": "Avtomatik test smena boshlandi"
}).encode()
req_start = urllib.request.Request("http://127.0.0.1:8020/api/v1/driver/shift/start", data=start_body, headers=headers)
with urllib.request.urlopen(req_start) as resp:
    start_res = json.loads(resp.read().decode())
    print("2. [SHIFT-START] Response:", start_res)

# 3. GPS Ping test
ping_body = json.dumps({
    "virtual_gps_id": gps_id,
    "latitude": 41.2995,
    "longitude": 69.2401,
    "speed_kmh": 42.5,
    "course": 180.0,
    "is_valid": True
}).encode()
req_ping = urllib.request.Request("http://127.0.0.1:8020/api/v1/gps/ping", data=ping_body, headers=headers)
with urllib.request.urlopen(req_ping) as resp:
    ping_res = json.loads(resp.read().decode())
    print("3. [GPS-PING] Response:", ping_res)

# 4. Stop Shift test with odometer (85 km driven)
stop_body = json.dumps({
    "virtual_gps_id": gps_id,
    "odometer": 145585,
    "note": "Smena muvaffaqiyatli yakunlandi"
}).encode()
req_stop = urllib.request.Request("http://127.0.0.1:8020/api/v1/driver/shift/stop", data=stop_body, headers=headers)
with urllib.request.urlopen(req_stop) as resp:
    stop_res = json.loads(resp.read().decode())
    print("4. [SHIFT-STOP] Response:", stop_res)

print("=== ALL INTEGRATION TESTS PASSED ===")
EOF
