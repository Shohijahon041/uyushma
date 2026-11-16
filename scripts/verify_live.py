import urllib.request
import json

url = "http://127.0.0.1:8020/api/v1/vehicles/live"
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())
    vehicles = data.get("data", [])
    assigned = [v for v in vehicles if v.get("driver_name") != "Biriktirilmagan"]
    print(f"Total live vehicles: {len(vehicles)}")
    print(f"Assigned with real drivers: {len(assigned)}")
    print("\nSample 5 assigned vehicles:")
    for v in assigned[:5]:
        print(f" - Plate: {v['plate_number']} | Model: {v['model']} | Driver: {v['driver_name']} | GPS ID: {v['virtual_gps_id']}")
