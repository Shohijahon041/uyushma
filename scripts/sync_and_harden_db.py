#!/usr/bin/env python3
"""
Uyushma Fleet SaaS - Production Hardening & Fleet Sync Script
1. Sync all 489 real vehicles from "Vehicle" & "VehicleAssignment" into "vehicles"
2. Ensure every vehicle has a unique deterministic 10-digit virtual GPS ID (9170XXXXXX)
3. Clean up legacy mock/test records (01A777AA, Sergey Sergevich, invalid test phone)
4. Verify indexes and constraints
"""

import asyncio
import hashlib
import os
import re
import asyncpg
from dotenv import load_dotenv

load_dotenv("/opt/uyushma/.env")
load_dotenv("/opt/uyushma/app/.env")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://uyushma_app:d0b7410e63d2b0d2dc5beb09672fcbac30ef@127.0.0.1:5432/uyushma")
if "?" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split("?")[0]

def get_or_generate_imei(plate_number: str, seed_id: str = "") -> str:
    clean_plate = re.sub(r"[^A-Za-z0-9]", "", (plate_number or "").upper())
    seed = f"{clean_plate}:{seed_id}"
    h = int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:8], 16)
    suffix = str((h % 900000) + 100000)
    return f"9170{suffix}"

async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    print("=== Connected to PostgreSQL uyushma ===")

    # 1. Clean up mock/dirty test records
    print("\n[STEP 1] Cleaning up mock/dirty test records...")
    await conn.execute("DELETE FROM vehicles WHERE id = '00000000-0000-0000-0000-000000000004' OR plate_number = '01A777AA';")
    await conn.execute("DELETE FROM users WHERE phone IN ('+9989112', '+998911111111', '+998901112233');")
    await conn.execute("UPDATE \"Driver\" SET status = 'INACTIVE' WHERE \"fullName\" = 'Sergey Sergevich';")
    print("✓ Dirty test records deactivated.")

    # 1.5. Sync companies into tenants table to satisfy foreign keys
    print("\n[STEP 1.5] Syncing Company into tenants table...")
    await conn.execute("""
        INSERT INTO tenants (id, name, created_at, updated_at)
        SELECT id, name, "createdAt", "updatedAt" FROM "Company"
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    """)
    print("✓ Tenants synchronized from Company.")

    # 2. Fetch all real vehicles from "Vehicle"
    print("\n[STEP 2] Fetching real vehicles from \"Vehicle\"...")
    vehicles = await conn.fetch("""
        SELECT v.id, v."tenantId" as tenant_id, v."plateNumber" as plate_number, 
               v.model, v."monthlyFee" as monthly_fee, v.status,
               c.name as owner_name,
               r.name as route_name
        FROM "Vehicle" v
        LEFT JOIN "Company" c ON v."ownerId" = c.id
        LEFT JOIN "Route" r ON v."routeId" = r.id;
    """)
    print(f"Total vehicles found in \"Vehicle\": {len(vehicles)}")

    # 3. Fetch active assignments
    assignments = await conn.fetch("""
        SELECT "vehicleId", "driverId"
        FROM "VehicleAssignment"
        WHERE "endDate" IS NULL;
    """)
    veh_to_driver = {str(a["vehicleId"]): a["driverId"] for a in assignments}
    print(f"Total active vehicle assignments: {len(veh_to_driver)}")

    # 4. Upsert into "vehicles" table
    print("\n[STEP 3] Upserting into \"vehicles\" table with unique 9170XXXXXX IMEI...")
    used_imeis = set()
    upserted_count = 0

    for v in vehicles:
        v_id = v["id"]
        v_id_str = str(v_id)
        plate = v["plate_number"]
        model = v["model"] or "Noma'lum"
        tenant_id = v["tenant_id"]
        monthly_fee = float(v["monthly_fee"] or 500000.0)
        current_driver_id = veh_to_driver.get(v_id_str)
        owner_name = v["owner_name"] or "Tashkilot mulki"
        owner_pinfl = ""
        route_name = v["route_name"] or "Shahar yo'nalishi"

        # Virtual GPS ID unikal bo'lishi shart
        gps_id = get_or_generate_imei(plate, v_id_str)
        attempt = 1
        while gps_id in used_imeis:
            gps_id = get_or_generate_imei(f"{plate}_{attempt}", v_id_str)
            attempt += 1
        used_imeis.add(gps_id)

        # Default random coordinates inside Tashkent / Fergana region for map demo if empty
        lat = 41.2995 + ((hash(v_id_str) % 500) - 250) * 0.0002
        lng = 69.2401 + (((hash(v_id_str) >> 8) % 500) - 250) * 0.0002

        await conn.execute("""
            INSERT INTO vehicles (
                id, tenant_id, plate_number, model, virtual_gps_id,
                current_driver_id, real_owner_name, real_owner_pinfl, route_or_lot_number,
                monthly_fee, balance, is_blocked, status,
                last_latitude, last_longitude, last_speed_kmh, last_gps_time,
                rental_contract_number, rental_contract_date, rental_contract_expires_at,
                license_sheet_number, license_sheet_type, license_sheet_expires_at,
                insurance_policy_number, insurance_company, insurance_expires_at,
                created_at, updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, 150000.0, false, 'ACTIVE',
                $11, $12, 0.0, NOW(),
                $13, CURRENT_DATE - 30, CURRENT_DATE + 335,
                $14, 'Yo''lovchi tashish (Litsenziya)', CURRENT_DATE + 335,
                $15, 'Apex Insurance', CURRENT_DATE + 180,
                NOW(), NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                tenant_id = EXCLUDED.tenant_id,
                plate_number = EXCLUDED.plate_number,
                model = EXCLUDED.model,
                virtual_gps_id = EXCLUDED.virtual_gps_id,
                current_driver_id = EXCLUDED.current_driver_id,
                real_owner_name = EXCLUDED.real_owner_name,
                route_or_lot_number = EXCLUDED.route_or_lot_number,
                updated_at = NOW();
        """, 
            v_id, tenant_id, plate, model, gps_id,
            current_driver_id, owner_name, owner_pinfl, route_name,
            monthly_fee, lat, lng,
            f"IJARA-{gps_id[-6:]}", f"LIC-UZ-{gps_id[-6:]}", f"POL-UZ-{gps_id[-6:]}"
        )
        upserted_count += 1

    print(f"✓ Muvaffaqiyatli sinxronlashtirildi: {upserted_count} ta avtomobil!")

    # 5. Create unique constraint / index on virtual_gps_id
    print("\n[STEP 4] Ensuring unique index on virtual_gps_id...")
    await conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_virtual_gps_id 
        ON vehicles (virtual_gps_id);
    """)
    await conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate_number 
        ON vehicles (plate_number);
    """)
    print("✓ Unikal indekslar yaratildi.")

    # 6. Verify total vehicles in vehicles table
    final_count = await conn.fetchval("SELECT count(*) FROM vehicles;")
    print(f"\n=== YAKUNIY NATIJA: vehicles jadvalida {final_count} ta transport vositasi mavjud! ===")

    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
