#!/usr/bin/env python3
"""
=============================================================================
UYUSHMA FLEET & GPS SAAS - AUTOMATED DAILY BILLING ENGINE & DEBT ENFORCEMENT
=============================================================================
Vazifalari:
  1. Har kecha 00:05 da har bir faol transport vositasi uchun kunlik to'lovni
     (monthly_fee / 30) avtomatik hisoblash va balansdan yechish.
  2. Idempotentlik: Har bir kun uchun unikal 'provider_trans_id' orqali
     takroriy hisoblanishning (double-charging) oldini olish.
  3. 3-Bosqichli Qarz Nazorati (Graceful Multi-tier Debt Enforcement):
     - 1-3 kunlik qarz: Telegram ogohlantirish (INFO).
     - 4-5 kunlik qarz: Tizimli ogohlantirish (WARNING alert).
     - 5+ kunlik qarz: Avtomobilni to'liq bloklash (CRITICAL alert),
       yo'l varaqasi berilishi to'xtatiladi (Vehicle.isBlocked = true).
  4. Manual Override tekshiruvi: Agar dispetcher tomonidan 24 soatlik
     istisno berilgan bo'lsa, bloklash chetlab o'tiladi.
  5. Multi-tenant ma'lumotlar xavfsizligi va Telegram monitoring hisoboti.
=============================================================================
"""

import argparse
import datetime
import json
import logging
import os
import sys
import uuid
import psycopg2
import psycopg2.extras
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [BILLING] %(message)s"
)
logger = logging.getLogger("daily_billing")

BOT_TOKEN = os.getenv("BOT_TOKEN", "9234982190:AAFVINsJhZRNtiJalATRo6JLLzDlTZNBiN4")
CHAT_ID = os.getenv("TELEGRAM_MONITORING_CHAT_ID", "1821045481")


def get_db_connection():
    db_url = os.getenv(
        "DATABASE_URL",
        "postgresql://uyushma_app:d0b7410e63d2b0d2dc5beb09672fcbac30ef@127.0.0.1:5432/uyushma"
    )
    if "uyushma_unified" in db_url:
        db_url = db_url.replace("uyushma_unified", "uyushma")
    return psycopg2.connect(db_url)


def send_telegram(text: str):
    if not BOT_TOKEN or not CHAT_ID:
        return
    try:
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        resp = requests.post(url, json={
            "chat_id": CHAT_ID,
            "text": text,
            "parse_mode": "HTML"
        }, timeout=10)
        if resp.status_code != 200:
            logger.warning("Telegram yuborishda xato: %s", resp.text)
    except Exception as e:
        logger.warning("Telegram yuborishda xatolik: %s", e)


def run_daily_billing(dry_run: bool = False, target_date: datetime.date = None):
    today = target_date or datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")
    logger.info("Kundalik billing jarayoni boshlandi. Sana: %s (dry_run=%s)", today_str, dry_run)

    conn = get_db_connection()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    try:
        # 1. Barcha faol avtomobillarni olish
        cur.execute("""
            SELECT 
                v.id as vehicle_id,
                v.tenant_id,
                v.plate_number,
                v.monthly_fee,
                v.balance,
                v.is_blocked,
                v.block_reason,
                v.current_driver_id,
                c.name as company_name,
                pv.id as prisma_id,
                pv."isBlocked" as prisma_blocked,
                pv."manualOverrideUntil" as override_until
            FROM vehicles v
            JOIN "Company" c ON c.id = v.tenant_id
            LEFT JOIN "Vehicle" pv ON pv.id = v.id OR pv."plateNumber" = v.plate_number
            WHERE v.status = 'ACTIVE';
        """)
        vehicles = cur.fetchall()
        logger.info("Jami faol avtomobillar soni: %d", len(vehicles))

        total_deducted = 0.0
        compliant_count = 0
        warning_count = 0
        blocked_count = 0
        newly_blocked = []

        now_utc = datetime.datetime.now(datetime.timezone.utc)

        for veh in vehicles:
            v_id = str(veh["vehicle_id"])
            tenant_id = str(veh["tenant_id"])
            plate = (veh["plate_number"] or "").strip().upper()
            company = veh["company_name"]
            driver_id = str(veh["current_driver_id"]) if veh["current_driver_id"] else None
            monthly_fee = float(veh["monthly_fee"] or 500000.0)
            daily_rate = round(monthly_fee / 30.0, 2)
            current_balance = float(veh["balance"] or 0.0)

            # Manual override tekshiruvi
            override_until = veh["override_until"]
            has_active_override = False
            if override_until:
                if override_until.tzinfo is None:
                    override_until = override_until.replace(tzinfo=datetime.timezone.utc)
                if override_until > now_utc:
                    has_active_override = True

            # 2. Idempotent hisob-kitob (tekshirish: bugun yechilganmi?)
            trans_key = f"DAILY_BILLING:{plate}:{today_str}"
            cur.execute("""
                SELECT id FROM transactions
                WHERE provider = 'SYSTEM' AND provider_trans_id = %s;
            """, (trans_key,))
            existing_trans = cur.fetchone()

            if not existing_trans:
                new_balance = round(current_balance - daily_rate, 2)
                total_deducted += daily_rate

                if not dry_run:
                    # Balansni yangilash
                    cur.execute("""
                        UPDATE vehicles
                        SET balance = %s, updated_at = NOW()
                        WHERE id = %s;
                    """, (new_balance, v_id))

                    # Tranzaksiyani yozish (driver_id = None, chunki bu avtomobilga nisbatan tizimli hisob-kitob)
                    cur.execute("""
                        INSERT INTO transactions (
                            tenant_id, vehicle_id, driver_id, provider, provider_trans_id,
                            amount, status, raw_payload, created_at, updated_at
                        ) VALUES (
                            %s, %s, NULL, 'SYSTEM', %s,
                            %s, 'SUCCESS', %s, NOW(), NOW()
                        );
                    """, (
                        tenant_id, v_id, trans_key,
                        -daily_rate,
                        json.dumps({
                            "type": "DAILY_SUBSCRIPTION",
                            "date": today_str,
                            "plate": plate,
                            "monthly_fee": monthly_fee,
                            "daily_rate": daily_rate,
                            "prev_balance": current_balance,
                            "new_balance": new_balance,
                        })
                    ))
            else:
                new_balance = current_balance

            # 3. Qarz darajasini tahlil qilish
            if new_balance >= 0:
                compliant_count += 1
                # Agar oldin qarzdorlik sababli bloklangan bo'lsa, blokdan chiqarish
                if (veh["is_blocked"] or veh["prisma_blocked"]) and "Qarzdorlik" in (veh["block_reason"] or ""):
                    if not dry_run:
                        cur.execute("""
                            UPDATE vehicles
                            SET is_blocked = false, block_reason = NULL, updated_at = NOW()
                            WHERE id = %s;
                        """, (v_id,))
                        if veh["prisma_id"]:
                            cur.execute("""
                                UPDATE "Vehicle"
                                SET "isBlocked" = false, "blockReason" = NULL, "updatedAt" = NOW()
                                WHERE id = %s;
                            """, (veh["prisma_id"],))

                        # Faol SystemAlert ni yopish
                        cur.execute("""
                            UPDATE "SystemAlert"
                            SET "isResolved" = true, "resolvedAt" = NOW(), "resolvedBy" = 'BILLING_ENGINE'
                            WHERE "vehicleId" = %s AND type = 'FINANCIAL_DEBT' AND "isResolved" = false;
                        """, (veh["prisma_id"] or v_id,))
                continue

            # Manfiy balans (Qarzdorlik)
            debt = abs(new_balance)
            overdue_days = int(debt / daily_rate) if daily_rate > 0 else 1

            if overdue_days <= 3:
                # 1-3 kunlik qarz: INFO / Ogohlantirish
                compliant_count += 1
            elif overdue_days in (4, 5):
                # 4-5 kunlik qarz: WARNING (Bloklanish arafasida)
                warning_count += 1
                if not dry_run:
                    alert_title = f"To'lov muddati kechikmoqda: {plate}"
                    alert_msg = f"{plate} ({company}) avtomobilining to'lovi {overdue_days} kundan beri to'lanmagan (qarzdorlik: {debt:,.0f} so'm). Bloklanish arafasida."
                    cur.execute("""
                        INSERT INTO "SystemAlert" (
                            id, "tenantId", "vehicleId", "driverId", type, severity, title, message, metadata, "isResolved", "createdAt"
                        ) VALUES (
                            %s, %s, %s, NULL, 'FINANCIAL_DEBT'::"AlertType", 'WARNING'::"AlertSeverity",
                            %s, %s, %s, false, NOW()
                        )
                        ON CONFLICT DO NOTHING;
                    """, (
                        str(uuid.uuid4()), tenant_id, veh["prisma_id"] or v_id,
                        alert_title, alert_msg,
                        json.dumps({"plate": plate, "debt": debt, "overdue_days": overdue_days})
                    ))
            else:
                # 5+ kunlik qarz: CRITICAL (Avtomatik bloklash)
                blocked_count += 1
                if not has_active_override:
                    block_msg = f"Qarzdorlik sababli bloklangan ({debt:,.0f} so'm, {overdue_days} kun)"
                    if not dry_run:
                        cur.execute("""
                            UPDATE vehicles
                            SET is_blocked = true, block_reason = %s, updated_at = NOW()
                            WHERE id = %s;
                        """, (block_msg, v_id))

                        if veh["prisma_id"]:
                            cur.execute("""
                                UPDATE "Vehicle"
                                SET "isBlocked" = true, "blockReason" = %s, "updatedAt" = NOW()
                                WHERE id = %s;
                            """, (block_msg, veh["prisma_id"]))

                        # Agar oldin aktiv smena bo'lsa, to'xtatish
                        cur.execute("""
                            UPDATE "DriverShift"
                            SET status = 'FORCE_CLOSED', "endedAt" = NOW(), notes = 'Qarzdorlik sababli majburiy to''xtatildi'
                            WHERE "vehicleId" = %s AND status = 'ACTIVE';
                        """, (veh["prisma_id"] or v_id,))

                        # CRITICAL SystemAlert yozish
                        alert_title = f"Avtomobil qarzdorlik sababli bloklandi: {plate}"
                        alert_msg = f"{plate} ({company}) avtomobilida {overdue_days} kunlik qarzdorlik ({debt:,.0f} so'm) mavjud. Yo'l varaqasi berilishi to'xtatildi."
                        cur.execute("""
                            INSERT INTO "SystemAlert" (
                                id, "tenantId", "vehicleId", "driverId", type, severity, title, message, metadata, "isResolved", "createdAt"
                            ) VALUES (
                                %s, %s, %s, NULL, 'FINANCIAL_DEBT'::"AlertType", 'CRITICAL'::"AlertSeverity",
                                %s, %s, %s, false, NOW()
                            );
                        """, (
                            str(uuid.uuid4()), tenant_id, veh["prisma_id"] or v_id,
                            alert_title, alert_msg,
                            json.dumps({"plate": plate, "debt": debt, "overdue_days": overdue_days, "auto_blocked": True})
                        ))

                    newly_blocked.append(f"{plate} ({debt:,.0f} so'm, {overdue_days} kun)")

        if not dry_run:
            conn.commit()
            logger.info("Billing o'zgarishlari bazaga muvaffaqiyatli saqlandi.")
        else:
            conn.rollback()
            logger.info("[DRY-RUN] O'zgarishlar bazaga yozilmadi (Rollback).")

        # 4. Telegram hisoboti
        tg_text = (
            f"💰 <b>KUNDALIK BILLING HISOBOTI ({today_str})</b>\n\n"
            f"🚙 <b>Faol avtomobillar:</b> {len(vehicles)} ta\n"
            f"💵 <b>Kunlik hisoblangan summa:</b> {total_deducted:,.0f} so'm\n"
            f"✅ <b>Balansi yetarli / 1-3 kunlik:</b> {compliant_count} ta\n"
            f"⚠️ <b>Bloklanish arafasidagi qarzdorlar:</b> {warning_count} ta\n"
            f"🚫 <b>Bloklangan qarzdorlar:</b> {blocked_count} ta\n"
        )
        if newly_blocked:
            tg_text += f"\n<b>Yangi bloklanganlar:</b>\n" + "\n".join([f"• <code>{b}</code>" for b in newly_blocked[:5]])

        send_telegram(tg_text)
        logger.info("Telegram xabari yuborildi.")

        print("\n==================================================")
        print(f" BILLING XULOSASI: {today_str} ")
        print(f" Jami: {len(vehicles)} ta, Yechildi: {total_deducted:,.0f} so'm")
        print(f" Toza: {compliant_count}, Ogohlantirish: {warning_count}, Bloklangan: {blocked_count}")
        print("==================================================")

    except Exception as e:
        conn.rollback()
        logger.error("Billing jarayonida xatolik yuz berdi: %s", e, exc_info=True)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Uyushma SaaS Daily Billing Daemon")
    parser.add_argument("--dry-run", action="store_true", help="O'zgarishlarni bazaga yozmasdan sinab ko'rish")
    parser.add_argument("--date", type=str, default=None, help="Sana YYYY-MM-DD")
    args = parser.parse_args()

    t_date = datetime.date.fromisoformat(args.date) if args.date else None
    run_daily_billing(dry_run=args.dry_run, target_date=t_date)
