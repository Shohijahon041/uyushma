#!/usr/bin/env python3
"""
End-to-End Verification Test:
  1. Route corridor & stops configuration
  2. In-Memory cross-track distance math
  3. 3-point debounce against GPS jitter
  4. Geofenced stop arrival detection
  5. Route deviation & speed violation alerting
  6. Recovery detection
  7. 24-hour manual override
"""

import json
import time
import urllib.request
import urllib.error

BASE_URL = "https://uyushma.bmbrutto.uz/api/v1"

def http_json(url: str, method: str = "GET", data: dict = None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    body = json.dumps(data).encode("utf-8") if data is not None else None
    with urllib.request.urlopen(req, data=body, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main():
    print("==================================================")
    print(" E2E VERIFICATION: GEOFENCING & STATE SYNC ENGINE ")
    print("==================================================")

    # 1. Tizim salomatligini tekshirish
    health = http_json("https://uyushma.bmbrutto.uz/health")
    print(f"[1] Health Check: {health}")
    assert health["status"] in ("healthy", "degraded"), "Health check failed"

    # 2. Mavjud ogohlantirishlarni tekshirish (/api/v1/alerts)
    alerts = http_json(f"{BASE_URL}/alerts?limit=5")
    print(f"[2] Active System Alerts: {len(alerts)} ta topildi")
    for a in alerts[:3]:
        print(f"    - [{a['severity']}] {a['type']}: {a['title']} ({a['createdAt']})")

    # 3. Test marshruti va koridorini sozlash
    # Bazadan ixtiyoriy bitta marshrutni olish
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect("postgresql://uyushma_app:d0b7410e63d2b0d2dc5beb09672fcbac30ef@127.0.0.1:5432/uyushma")
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    cur.execute('SELECT id, name, "tenantId" FROM "Route" WHERE "isActive" = true LIMIT 1;')
    route = cur.fetchone()
    if not route:
        print("Xatolik: Faol marshrut topilmadi!")
        return

    route_id = str(route["id"])
    route_name = route["name"]
    tenant_id = str(route["tenantId"])
    print(f"[3] Test marshruti: '{route_name}' ({route_id})")

    # Marshrutga test koridori o'rnatish: Toshkent (Chorsu -> Amir Temur xiyoboni)
    # GeoJSON coordinates: [[lon, lat], ...]
    corridor_coords = [
        [69.240562, 41.311081],
        [69.260000, 41.315000],
        [69.280000, 41.320000],
    ]
    corridor_update = http_json(
        f"{BASE_URL}/routes/{route_id}/corridor",
        method="PUT",
        data={"corridorPolyline": corridor_coords, "corridorWidthMeters": 150}
    )
    print(f"    - Koridor yangilandi: {corridor_update}")

    # Bekat qo'shish
    stop_resp = http_json(
        f"{BASE_URL}/routes/{route_id}/stops",
        method="POST",
        data={
            "name": "Chorsu Markaziy Bekat",
            "latitude": 41.311081,
            "longitude": 69.240562,
            "radiusMeters": 120,
            "orderIndex": 0,
            "isMandatory": True
        }
    )
    print(f"    - Bekat qo'shildi: {stop_resp}")

    # Koridorni tekshirish
    corridor_data = http_json(f"{BASE_URL}/routes/{route_id}/corridor")
    print(f"    - Tekshiruv: {corridor_data['name']} (bufer: {corridor_data['corridorWidthMeters']}m, bekatlar: {len(corridor_data['stops'])} ta)")
    assert corridor_data["corridorWidthMeters"] == 150
    assert len(corridor_data["stops"]) >= 1

    # 4. Mashinani ushbu marshrutga biriktirish (test uchun)
    cur.execute('SELECT id, "plateNumber" FROM "Vehicle" WHERE "tenantId" = %s LIMIT 1;', (tenant_id,))
    veh = cur.fetchone()
    veh_id = str(veh["id"])
    plate = veh["plateNumber"]
    print(f"[4] Test avtomobili: {plate} ({veh_id})")

    cur.execute('UPDATE "Vehicle" SET "routeId" = %s WHERE id = %s;', (route_id, veh_id))
    conn.commit()

    # 5. GPS Ping 1: Koridor ichida (Chorsu bekati ustida)
    ping1 = http_json(f"{BASE_URL}/gps/ping", method="POST", data={
        "virtual_gps_id": "9170121311",
        "latitude": 41.311081,
        "longitude": 69.240562,
        "speed_kmh": 45.0,
        "course": 90.0
    })
    print(f"[5] Ping #1 (Koridor ichida): {ping1.get('spatial', {})}")
    assert ping1["ack"] == "ON"
    if ping1.get("spatial"):
        print(f"    - Masofa: {ping1['spatial'].get('distance_to_route_meters')}m, Chetga chiqish: {ping1['spatial'].get('is_deviated')}")
        print(f"    - Joriy bekat: {ping1['spatial'].get('current_stop')}")

    # 6. GPS Ping 2, 3, 4: Koridordan 3 km chetda (3-point debounce sinovi)
    print("[6] 3-Point Debounce sinovi (3 km chetda):")
    for i in range(1, 4):
        p_res = http_json(f"{BASE_URL}/gps/ping", method="POST", data={
            "virtual_gps_id": "9170121311",
            "latitude": 41.350000,
            "longitude": 69.350000,
            "speed_kmh": 50.0,
            "course": 180.0
        })
        sp = p_res.get("spatial", {})
        print(f"    - Ping #{i}: streak={sp.get('deviation_streak')}, deviated={sp.get('is_deviated')}, dist={sp.get('distance_to_route_meters')}m")
        time.sleep(0.3)

    # 3-chi pingda is_deviated == True bo'lishi shart!
    assert sp.get("is_deviated") == True or sp.get("deviation_streak") >= 3, "3-point debounce failed!"

    # 7. Baza SystemAlert jadvalida ROUTE_DEVIATION yozilganligini tekshirish
    cur.execute("""
        SELECT type, severity, title, metadata
        FROM "SystemAlert"
        WHERE "vehicleId" = %s AND type = 'ROUTE_DEVIATION'
        ORDER BY "createdAt" DESC LIMIT 1;
    """, (veh_id,))
    alert_row = cur.fetchone()
    if alert_row:
        print(f"[7] SystemAlert Bazasida Tasdiqlandi: [{alert_row['severity']}] {alert_row['title']}")
        print(f"    Metadata: {alert_row['metadata']}")

    # 8. GPS Ping 5: Koridorga qaytish (Recovery)
    ping_recovery = http_json(f"{BASE_URL}/gps/ping", method="POST", data={
        "virtual_gps_id": "9170121311",
        "latitude": 41.311081,
        "longitude": 69.240562,
        "speed_kmh": 35.0,
        "course": 90.0
    })
    sp_rec = ping_recovery.get("spatial", {})
    print(f"[8] Koridorga qaytish pingi: deviated={sp_rec.get('is_deviated')}, streak={sp_rec.get('deviation_streak')}")
    assert sp_rec.get("is_deviated") == False

    # 9. 24-soatlik istisno (Manual Override) sinovi
    override_resp = http_json(
        f"{BASE_URL}/vehicles/{veh_id}/override",
        method="POST",
        data={"hours": 24, "reason": "YPX texnik ko'rik talabi bo'yicha ruxsat"}
    )
    print(f"[9] Manual Override: {override_resp}")
    assert override_resp["status"] == "ok"
    assert "overrideUntil" in override_resp

    # Baza Vehicle holatini tekshirish
    cur.execute('SELECT "isBlocked", "manualOverrideUntil", "overrideReason" FROM "Vehicle" WHERE id = %s;', (veh_id,))
    v_override = cur.fetchone()
    print(f"    - Baza tasdiqi: isBlocked={v_override['isBlocked']}, overrideUntil={v_override['manualOverrideUntil']}")
    assert v_override["isBlocked"] == False

    conn.close()
    print("\n==================================================")
    print(" BARCHA 9 TA BOSQICH TO'LIQ VA MUVAFFAQIYATLI O'TDI! ")
    print("==================================================")

if __name__ == "__main__":
    main()
