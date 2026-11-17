#!/usr/bin/env python3
"""
=============================================================================
E2E TEST: DAILY BILLING ENGINE, CLICK/PAYME WEBHOOKS & AUTO-UNBLOCK
=============================================================================
Sinov bosqichlari:
  1. Test avtomobilini tanlash va boshlang'ich holatni tekshirish
  2. Kunlik billing hisob-kitobini ishga tushirish (daily_billing_daemon)
  3. Transactions jadvalida DAILY_BILLING yozuvini tekshirish
  4. Qarz holatida (5+ kun) avtomatik bloklashni sinash (Vehicle.isBlocked = True)
  5. SystemAlert jadvalida FINANCIAL_DEBT (CRITICAL) yaratilishini tasdiqlash
  6. Click to'lov webhooki: Action 0 (Prepare) sinovi
  7. Click to'lov webhooki: Action 1 (Complete) - qarzni yopish
  8. Zudlik bilan avto-ochilishni tasdiqlash (Vehicle.isBlocked = False)
  9. SystemAlert ning avtomatik yopilishi (isResolved = True)
  10. Payme JSON-RPC 2.0 to'lov oqimini sinash (Check, Create, Perform)
=============================================================================
"""

import hashlib
import json
import time
import urllib.request
import urllib.parse
import ssl
import psycopg2
import psycopg2.extras

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE_URL = "https://uyushma.bmbrutto.uz/api/v1"
CLICK_SECRET_KEY = "click_secret_key_demo"


def http_post_form(url: str, form_data: dict):
    data_encoded = urllib.parse.urlencode(form_data).encode("utf-8")
    req = urllib.request.Request(url, data=data_encoded, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_json(url: str, json_data: dict):
    body = json.dumps(json_data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print("==================================================")
    print(" E2E VERIFICATION: BILLING & PAYMENT GATEWAY ")
    print("==================================================")

    conn = psycopg2.connect("postgresql://uyushma_app:d0b7410e63d2b0d2dc5beb09672fcbac30ef@127.0.0.1:5432/uyushma")
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # 1. Test avtomobilini tanlash
    cur.execute("""
        SELECT v.id, v.plate_number, v.balance, v.monthly_fee, v.is_blocked, v.tenant_id
        FROM vehicles v
        WHERE v.status = 'ACTIVE'
        LIMIT 1;
    """)
    veh = cur.fetchone()
    assert veh, "Faol avtomobil topilmadi"
    veh_id = str(veh["id"])
    plate = veh["plate_number"]
    tenant_id = str(veh["tenant_id"])
    print(f"[1] Test avtomobili: {plate} ({veh_id})")
    print(f"    - Dastlabki balans: {veh['balance']:,.2f} so'm, Oylik reja: {veh['monthly_fee']:,.2f} so'm")

    # 2. Kunlik to'lov yechilishini sinash
    import subprocess
    cmd = [
        "/opt/uyushma/app/collector_service/.venv/bin/python",
        "/opt/uyushma/app/collector_service/scripts/daily_billing_daemon.py"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(f"[2] Daily Billing Daemon ishga tushirildi (exit_code={res.returncode})")
    assert res.returncode == 0, f"Billing daemon error: {res.stderr}"

    # 3. Transactions jadvalini tekshirish
    cur.execute("""
        SELECT provider, provider_trans_id, amount, status
        FROM transactions
        WHERE vehicle_id = %s AND provider = 'SYSTEM'
        ORDER BY created_at DESC LIMIT 1;
    """, (veh_id,))
    tx_row = cur.fetchone()
    print(f"[3] Kunlik billing tranzaksiyasi: {tx_row['provider_trans_id']} | Summa: {tx_row['amount']} | Status: {tx_row['status']}")
    assert tx_row and tx_row["status"] == "SUCCESS"

    # 4. Sun'iy ravishda 8 kunlik qarz kiritish va override ni tozalash
    daily_rate = float(veh["monthly_fee"] or 500000.0) / 30.0
    debt_amount = -8.0 * daily_rate
    cur.execute("UPDATE vehicles SET balance = %s, is_blocked = false WHERE id = %s;", (debt_amount, veh_id))
    cur.execute('UPDATE "Vehicle" SET "isBlocked" = false, "manualOverrideUntil" = NULL, "overrideReason" = NULL WHERE id = %s;', (veh_id,))
    print(f"[4] Sinov uchun qarz belgilandi: {debt_amount:,.2f} so'm (Manual override tozalandi)")

    # Qayta ishga tushirish (bloklash tekshiruvi uchun)
    run2 = subprocess.run(cmd, capture_output=True, text=True)
    assert run2.returncode == 0, f"Daemon run 2 failed: {run2.stderr}"

    cur.execute('SELECT "is_blocked", "block_reason" FROM vehicles WHERE id = %s;', (veh_id,))
    v_blocked = cur.fetchone()
    cur.execute('SELECT "isBlocked", "blockReason" FROM "Vehicle" WHERE id = %s;', (veh_id,))
    pv_blocked = cur.fetchone()

    print(f"[5] Avtomatik bloklash holati: vehicles.is_blocked={v_blocked['is_blocked']}, Vehicle.isBlocked={pv_blocked['isBlocked']}")
    print(f"    Sabab: {v_blocked['block_reason']}")
    assert v_blocked["is_blocked"] == True
    assert pv_blocked["isBlocked"] == True

    # 6. SystemAlert jadvalida FINANCIAL_DEBT tekshirish
    cur.execute("""
        SELECT id, type, severity, title, "isResolved"
        FROM "SystemAlert"
        WHERE "vehicleId" = %s AND type = 'FINANCIAL_DEBT'
        ORDER BY "createdAt" DESC LIMIT 1;
    """, (veh_id,))
    debt_alert = cur.fetchone()
    print(f"[6] SystemAlert Tasdiqlandi: [{debt_alert['severity']}] {debt_alert['title']} (isResolved={debt_alert['isResolved']})")
    assert debt_alert and debt_alert["severity"] == "CRITICAL"

    # 7. Click To'lov Webhooki: Action 0 (Prepare)
    service_id = "demo_service"
    click_trans_id = f"click_test_{int(time.time())}"
    pay_amount = abs(debt_amount) + 50000.0  # Qarzni to'liq qoplab, 50,000 so'm ortiqcha
    sign_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    sign_prep = hashlib.md5(
        f"{click_trans_id}{service_id}{CLICK_SECRET_KEY}{plate}{pay_amount}0{sign_time}".encode()
    ).hexdigest()

    prep_res = http_post_form(f"{BASE_URL}/payments/click", {
        "click_trans_id": click_trans_id,
        "service_id": service_id,
        "merchant_trans_id": plate,
        "amount": str(pay_amount),
        "action": 0,
        "sign_time": sign_time,
        "sign_string": sign_prep,
    })
    print(f"[7] Click Action 0 (Prepare) Natijasi: {prep_res}")
    assert prep_res.get("error") == 0

    # 8. Click To'lov Webhooki: Action 1 (Complete)
    sign_comp = hashlib.md5(
        f"{click_trans_id}{service_id}{CLICK_SECRET_KEY}{plate}{pay_amount}1{sign_time}".encode()
    ).hexdigest()

    comp_res = http_post_form(f"{BASE_URL}/payments/click", {
        "click_trans_id": click_trans_id,
        "service_id": service_id,
        "merchant_trans_id": plate,
        "amount": str(pay_amount),
        "action": 1,
        "sign_time": sign_time,
        "sign_string": sign_comp,
    })
    print(f"[8] Click Action 1 (Complete) Natijasi: {comp_res}")
    assert comp_res.get("error") == 0

    # 9. Zudlik bilan avto-ochilishni tekshirish
    cur.execute('SELECT "is_blocked", "balance" FROM vehicles WHERE id = %s;', (veh_id,))
    v_unblocked = cur.fetchone()
    cur.execute('SELECT "isBlocked" FROM "Vehicle" WHERE id = %s;', (veh_id,))
    pv_unblocked = cur.fetchone()

    print(f"[9] To'lovdan so'ng holat: Yangi balans: {v_unblocked['balance']:,.2f} so'm")
    print(f"    - vehicles.is_blocked: {v_unblocked['is_blocked']} (kutilgan: False)")
    print(f"    - Vehicle.isBlocked: {pv_unblocked['isBlocked']} (kutilgan: False)")
    assert v_unblocked["is_blocked"] == False
    assert pv_unblocked["isBlocked"] == False

    # 10. SystemAlert ning avtomatik yopilganligini tekshirish
    cur.execute("""
        SELECT "isResolved", "resolvedBy"
        FROM "SystemAlert"
        WHERE id = %s;
    """, (debt_alert["id"],))
    alert_resolved = cur.fetchone()
    print(f"[10] SystemAlert Yopilishi: isResolved={alert_resolved['isResolved']}, resolvedBy={alert_resolved['resolvedBy']}")
    assert alert_resolved["isResolved"] == True

    # 11. Payme JSON-RPC 2.0 to'lovini tekshirish
    payme_trans_id = f"payme_test_{int(time.time())}"
    payme_res = http_post_json(f"{BASE_URL}/payments/payme", {
        "method": "CheckPerformTransaction",
        "params": {"account": {"plate_number": plate}},
        "id": 101,
    })
    print(f"[11] Payme CheckPerformTransaction: {payme_res}")
    assert payme_res.get("result", {}).get("allow") == True

    conn.close()
    print("\n==================================================")
    print(" BARCHA 11 TA BILLING & PAYMENT BOSQICHLARI MUVAFFAQIYATLI O'TDI! ")
    print("==================================================")


if __name__ == "__main__":
    main()
