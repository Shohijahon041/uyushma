#!/usr/bin/env python3
"""
Uyushma — 24/7 Hybrid State Sync Daemon
=========================================
O'zbekiston davlat portallari (ijara.soliq.uz, e-tender.uztrans.uz, bm.dtransport.uz)
bilan uzluksiz integratsiya va nazorat tizimi.

Rejimlar:
  --deep : Har kecha (02:00) barcha 385+ avtomobillar bo'yicha to'liq tekshiruv va sinxronizatsiya.
  --delta: Har 4 soatda amal qilish muddati <= 7 kun qolgan avtomobillarni tezkor tekshiruv.

Siyosat (Graceful Enforcement):
  - manualOverrideUntil > now(): Qo'lda kiritilgan istisno (24 soatlik ruxsat) faol bo'lsa, avtoblok o'tkazib yuboriladi.
  - 0 < days_left <= 3: Yumshoq ogohlantirish (WARNING) - Telegram va Dashboard ga xabar yuboriladi, avtomobil bloklanmaydi.
  - days_left <= 0: Avtoblok (CRITICAL) - Vehicle.isBlocked = true, blockReason yangilanadi, yo'l varaqasi berilishi to'xtatiladi.
  - days_left > 3 (hujjat uzaytirilganda): Avto-unblock (INFO) - Vehicle.isBlocked = false, blockReason = null.
"""

import argparse
import json
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

# Root papkani sozlash
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(BASE_DIR / "logs" / "hybrid_state_sync.log", encoding="utf-8") if (BASE_DIR / "logs").exists() else logging.NullHandler()
    ]
)
logger = logging.getLogger("hybrid_state_sync")

# Muhit o'zgaruvchilarini yuklash
def load_environment():
    candidate_envs = [
        Path("/opt/uyushma/.env"),
        BASE_DIR / ".env",
        BASE_DIR.parent / ".env"
    ]
    env_vars = {}
    for p in candidate_envs:
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip().strip('"').strip("'")
    return env_vars

ENV = load_environment()

DATABASE_URL = os.getenv("DATABASE_URL") or ENV.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/uyushma")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY") or ENV.get("INTERNAL_API_KEY", "")
BOT_TOKEN = os.getenv("BOT_TOKEN") or ENV.get("BOT_TOKEN") or ENV.get("TELEGRAM_BOT_TOKEN", "9234982190:AAFVINsJhZRNtiJalATRo6JLLzDlTZNBiN4")
TELEGRAM_MONITORING_CHAT = os.getenv("TELEGRAM_MONITORING_CHAT_ID") or ENV.get("TELEGRAM_CHAT_ID") or "1821045481"
NESTJS_INTERNAL_URL = os.getenv("API_INTERNAL_URL") or "http://127.0.0.1:4010/api/v1/internal/external"


def get_db_connection():
    """PostgreSQL bazasiga to'g'ridan-to'g'ri psycopg2 ulanishi."""
    import psycopg2
    import psycopg2.extras

    # Parametrlarni tozalash (schema parametrini olib tashlash)
    clean_url = DATABASE_URL
    if "?" in clean_url:
        clean_url = clean_url.split("?")[0]

    conn = psycopg2.connect(clean_url)
    conn.autocommit = False
    return conn


def normalize_plate(plate: Optional[str]) -> str:
    if not plate:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(plate).strip().upper())


class TelegramAlertService:
    def __init__(self, token: str, default_chat_id: str):
        self.token = token
        self.default_chat_id = default_chat_id

    def send_alert(self, text: str, chat_id: Optional[str] = None) -> bool:
        target_chat = chat_id or self.default_chat_id
        if not self.token or not target_chat:
            logger.warning("Telegram sozlamalari mavjud emas. Xabar yuborilmadi.")
            return False

        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        payload = {
            "chat_id": target_chat,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }

        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 200:
                return True
            else:
                logger.error(f"Telegram API xatoligi ({resp.status_code}): {resp.text}")
                return False
        except Exception as e:
            logger.error(f"Telegram API ga bog'lanishda xato: {e}")
            return False


telegram = TelegramAlertService(BOT_TOKEN, TELEGRAM_MONITORING_CHAT)


class HybridStateSyncDaemon:
    def __init__(self, mode: str = "delta"):
        self.mode = mode  # "deep" yoki "delta"
        self.conn = get_db_connection()

    def run(self):
        logger.info(f"==================================================")
        logger.info(f"HYBRID STATE SYNC DAEMON BOSHLANDI [Rejim: {self.mode.upper()}]")
        logger.info(f"Vaqt: {datetime.now(timezone.utc).isoformat()}")
        logger.info(f"==================================================")

        try:
            # 1. NestJS sync & watchdog trigger
            self._trigger_upstream_sync()

            # 2. Baza bo'yicha qonuniylik va amal qilish muddatlarini tekshirish
            self._evaluate_fleet_compliance()

            logger.info("Hybrid State Sync muvaffaqiyatli yakunlandi.")
        except Exception as e:
            logger.exception(f"Hybrid State Sync da jiddiy xatolik yuz berdi: {e}")
            self.conn.rollback()
            raise
        finally:
            self.conn.close()

    def _trigger_upstream_sync(self):
        """Ichki NestJS API orqali watchdog va sinxronizatsiyani ishga tushirish."""
        headers = {
            "Content-Type": "application/json",
            "x-internal-api-key": INTERNAL_API_KEY,
        }

        # Watchdog: tokenlarni yangilash
        try:
            url_watchdog = f"{NESTJS_INTERNAL_URL}/watchdog-tick"
            logger.info(f"Watchdog tick chaqirilmoqda: {url_watchdog}")
            resp = requests.post(url_watchdog, headers=headers, timeout=60)
            if resp.status_code in (200, 201):
                logger.info(f"Watchdog javobi: {resp.json()}")
            else:
                logger.warning(f"Watchdog {resp.status_code} qaytardi: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Watchdog-tick ulanishida xato (davom etiladi): {e}")

        # Deep sync bo'lsa, barcha provayderlar bo'yicha yangi ma'lumotlarni tortib olish
        if self.mode == "deep":
            try:
                url_sync = f"{NESTJS_INTERNAL_URL}/sync-all"
                logger.info(f"Deep Sync-All chaqirilmoqda: {url_sync}")
                resp = requests.post(url_sync, headers=headers, timeout=240)
                if resp.status_code in (200, 201):
                    logger.info("Deep sync-all muvaffaqiyatli yakunlandi.")
                else:
                    logger.warning(f"Sync-all {resp.status_code} qaytardi: {resp.text[:200]}")
            except Exception as e:
                logger.warning(f"Sync-all chaqirishda xato (davom etiladi): {e}")

    def _evaluate_fleet_compliance(self):
        """
        Barcha transport vositalari uchun ijara shartnomasi va litsenziya muddatlarini tekshirish.
        Graceful enforcement:
          - manualOverrideUntil > now(): Log va o'tkazib yuborish.
          - 0 < days_left <= 3: Warning alert va Telegram bildirishnoma.
          - days_left <= 0: Auto-block (isBlocked=true, CRITICAL alert, Telegram).
          - days_left > 3 & previously blocked: Auto-unblock (isBlocked=false, INFO alert, Telegram).
        """
        import psycopg2.extras
        cur = self.conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # Barcha korxonalar va ularning avtomobillarini olish
        cur.execute("""
            SELECT 
                v.id, 
                v."tenantId", 
                v."plateNumber", 
                v.model, 
                v."isBlocked", 
                v."blockReason", 
                v."manualOverrideUntil", 
                v."overrideReason",
                c.name as "companyName"
            FROM "Vehicle" v
            JOIN "Company" c ON c.id = v."tenantId"
            WHERE c.status = 'ACTIVE'
            ORDER BY v."plateNumber" ASC;
        """)
        vehicles = cur.fetchall()
        logger.info(f"Bazadan {len(vehicles)} ta transport vositasi tahlil uchun olindi.")

        now_utc = datetime.now(timezone.utc)
        stats = {
            "total": len(vehicles),
            "compliant": 0,
            "warning": 0,
            "blocked": 0,
            "overridden": 0,
            "unblocked": 0,
        }

        for veh in vehicles:
            v_id = str(veh["id"])
            tenant_id = str(veh["tenantId"])
            plate = veh["plateNumber"]
            norm_plate = normalize_plate(plate)
            is_blocked = veh["isBlocked"]
            block_reason = veh["blockReason"] or ""
            override_until = veh["manualOverrideUntil"]
            override_reason = veh["overrideReason"] or ""
            company_name = veh["companyName"]

            # Istisno (Manual Override) tekshiruvi
            has_active_override = False
            if override_until:
                # Agar override_until timezone-naive bo'lsa, UTC qilib olamiz
                if override_until.tzinfo is None:
                    override_until = override_until.replace(tzinfo=timezone.utc)
                if override_until > now_utc:
                    has_active_override = True

            # Ushbu avtomobilga tegishli tashqi yozuvlar (E-Tender litsenziyasi va Soliq ijara shartnomasi)
            # 1. E-Tender litsenziyasi
            cur.execute("""
                SELECT "licenseNumber", "licenseExpiresAt", provider, "routeName"
                FROM "ExternalVehicle"
                WHERE "tenantId" = %s AND (
                    UPPER(REPLACE("plateNumber", ' ', '')) = %s OR "vehicleId" = %s
                ) AND provider = 'ETENDER'
                ORDER BY "licenseExpiresAt" DESC NULLS LAST
                LIMIT 1;
            """, (tenant_id, norm_plate, v_id))
            etender_row = cur.fetchone()

            # 2. Soliq Ijara shartnomasi
            cur.execute("""
                SELECT "number", "startsAt", "endsAt", raw, status
                FROM "ExternalRecord"
                WHERE "tenantId" = %s AND kind = 'RENT_CONTRACT' AND (
                    UPPER(REPLACE(raw->>'vehicleNumber', ' ', '')) = %s OR
                    UPPER(REPLACE(raw->>'car_number', ' ', '')) = %s OR
                    UPPER(REPLACE(title, ' ', '')) LIKE %s
                )
                ORDER BY "endsAt" DESC NULLS LAST
                LIMIT 1;
            """, (tenant_id, norm_plate, norm_plate, f"%{norm_plate}%"))
            ijara_row = cur.fetchone()

            # Muddatlarni hisoblash
            min_days_left: Optional[int] = None
            critical_doc_type: Optional[str] = None
            critical_expiry_date: Optional[datetime] = None

            # E-tender tekshiruvi
            if etender_row and etender_row["licenseExpiresAt"]:
                exp = etender_row["licenseExpiresAt"]
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                d_left = (exp.date() - now_utc.date()).days
                if min_days_left is None or d_left < min_days_left:
                    min_days_left = d_left
                    critical_doc_type = "E-Tender yo'nalish litsenziyasi"
                    critical_expiry_date = exp

            # Ijara shartnomasi tekshiruvi
            if ijara_row and ijara_row["endsAt"]:
                exp = ijara_row["endsAt"]
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                d_left = (exp.date() - now_utc.date()).days
                if min_days_left is None or d_left < min_days_left:
                    min_days_left = d_left
                    critical_doc_type = "ijara.soliq.uz ijara shartnomasi"
                    critical_expiry_date = exp

            # Delta rejimida, agar muddat > 7 kun bo'lsa va avtomobil bloklanmagan bo'lsa, o'tkazamiz
            if self.mode == "delta" and min_days_left is not None and min_days_left > 7 and not is_blocked:
                stats["compliant"] += 1
                continue

            # HOLAT 1: Hujjat muddati o'tgan (min_days_left <= 0)
            if min_days_left is not None and min_days_left <= 0:
                expiry_str = critical_expiry_date.strftime("%d.%m.%Y") if critical_expiry_date else "Noma'lum"

                if has_active_override:
                    stats["overridden"] += 1
                    logger.info(
                        f"[OVERRIDE AKTIV] {plate} ({company_name}): {critical_doc_type} muddati o'tgan ({min_days_left} kun), "
                        f"lekin qo'lda ruxsat mavjud ({override_until.strftime('%d.%m.%Y %H:%M')}). Sabab: {override_reason}"
                    )
                    self._create_system_alert(
                        cur=cur,
                        tenant_id=tenant_id,
                        vehicle_id=v_id,
                        alert_type="STATE_SYNC_EXPIRY",
                        severity="WARNING",
                        title=f"Qo'lda ruxsat berilgan: {plate}",
                        message=f"{plate} avtomobilining {critical_doc_type} muddati o'tgan ({expiry_str}), biroq {override_until.strftime('%d.%m.%Y %H:%M')} gacha qo'lda istisno ruxsati faol. Sabab: {override_reason}",
                        metadata={"plate": plate, "days_left": min_days_left, "override_until": override_until.isoformat()}
                    )
                else:
                    stats["blocked"] += 1
                    new_block_reason = f"Muddati o'tgan: {critical_doc_type} ({expiry_str})"
                    if not is_blocked or block_reason != new_block_reason:
                        logger.warning(f"[AVTO-BLOK] {plate} ({company_name}) bloklanmoqda! Sabab: {new_block_reason}")
                        cur.execute("""
                            UPDATE "Vehicle"
                            SET "isBlocked" = true, "blockReason" = %s, "updatedAt" = CURRENT_TIMESTAMP
                            WHERE id = %s;
                        """, (new_block_reason, v_id))

                        self._create_system_alert(
                            cur=cur,
                            tenant_id=tenant_id,
                            vehicle_id=v_id,
                            alert_type="STATE_SYNC_EXPIRY",
                            severity="CRITICAL",
                            title=f"Transport vositasi bloklandi: {plate}",
                            message=f"{plate} ({company_name}) avtomobilining {critical_doc_type} muddati {expiry_str} da tugagan ({abs(min_days_left)} kun oldin). Yo'l varaqasi berilishi to'xtatildi.",
                            metadata={"plate": plate, "doc": critical_doc_type, "expiry": expiry_str, "days_left": min_days_left}
                        )

                        # Telegram xabari
                        tg_msg = (
                            f"🚨 <b>TRANSPORT VOSITASI BLOKLANDI!</b>\n\n"
                            f"🚗 <b>Davlat raqami:</b> <code>{plate}</code>\n"
                            f"🏢 <b>Korxona:</b> {company_name}\n"
                            f"📋 <b>Hujjat:</b> {critical_doc_type}\n"
                            f"⏳ <b>Amal qilish muddati:</b> {expiry_str} (<b>{abs(min_days_left)} kun oldin tugagan</b>)\n"
                            f"⛔ <b>Holat:</b> Yo'l varaqasi (Putyovka) berish to'xtatildi.\n\n"
                            f"<i>Iltimos, ijara shartnomasi yoki litsenziyani rasmiylashtiring.</i>"
                        )
                        telegram.send_alert(tg_msg)

            # HOLAT 2: Grace period - Yumshoq ogohlantirish (0 < min_days_left <= 3)
            elif min_days_left is not None and 0 < min_days_left <= 3:
                stats["warning"] += 1
                expiry_str = critical_expiry_date.strftime("%d.%m.%Y") if critical_expiry_date else "Noma'lum"
                logger.info(f"[OGOHLANTIRISH] {plate} ({company_name}): {critical_doc_type} muddati tugashiga {min_days_left} kun qoldi.")

                # Agar avval nohaq bloklangan bo'lsa, blokdan ochish
                if is_blocked and "Muddati o'tgan" in block_reason:
                    cur.execute("""
                        UPDATE "Vehicle"
                        SET "isBlocked" = false, "blockReason" = NULL, "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = %s;
                    """, (v_id,))

                self._create_system_alert(
                    cur=cur,
                    tenant_id=tenant_id,
                    vehicle_id=v_id,
                    alert_type="STATE_SYNC_EXPIRY",
                    severity="WARNING",
                    title=f"Diqqat: {plate} hujjat muddati tugamoqda",
                    message=f"{plate} ({company_name}) avtomobilining {critical_doc_type} muddati tugashiga {min_days_left} kun qoldi ({expiry_str}).",
                    metadata={"plate": plate, "doc": critical_doc_type, "expiry": expiry_str, "days_left": min_days_left}
                )

                # Telegram xabari (faqat deep rejimida yoki 1 kun qolganda takror yuboriladi)
                if self.mode == "deep" or min_days_left <= 1:
                    tg_msg = (
                        f"⚠️ <b>OGOHLANTIRISH: Hujjat muddati tugamoqda!</b>\n\n"
                        f"🚗 <b>Davlat raqami:</b> <code>{plate}</code>\n"
                        f"🏢 <b>Korxona:</b> {company_name}\n"
                        f"📋 <b>Hujjat:</b> {critical_doc_type}\n"
                        f"⏳ <b>Qolgan vaqt:</b> <b>{min_days_left} kun</b> ({expiry_str})\n\n"
                        f"ℹ️ <i>Eslatma: Muddat tugagach tizim avtomatik ravishda transport vositasini bloklaydi.</i>"
                    )
                    telegram.send_alert(tg_msg)

            # HOLAT 3: Hujjat to'liq faol va amal qilish muddati yaxshi (min_days_left > 3)
            else:
                stats["compliant"] += 1
                # Agar avval muddati o'tgani sababli bloklangan bo'lsa va endi yangilangan bo'lsa -> AUTO-UNBLOCK
                if is_blocked and ("Muddati o'tgan" in block_reason or "Hujjat muddati tugagan" in block_reason):
                    stats["unblocked"] += 1
                    logger.info(f"[AVTO-UNBLOCK] {plate} ({company_name}) blokdan chiqarildi! Hujjatlar yangilangan.")
                    cur.execute("""
                        UPDATE "Vehicle"
                        SET "isBlocked" = false, "blockReason" = NULL, "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = %s;
                    """, (v_id,))

                    expiry_str = critical_expiry_date.strftime("%d.%m.%Y") if critical_expiry_date else "Uzaytirildi"
                    self._create_system_alert(
                        cur=cur,
                        tenant_id=tenant_id,
                        vehicle_id=v_id,
                        alert_type="STATE_SYNC_EXPIRY",
                        severity="INFO",
                        title=f"Transport vositasi blokdan chiqarildi: {plate}",
                        message=f"{plate} avtomobili hujjati yangilandi ({expiry_str}) va avtomatik ravishda blokdan chiqarildi.",
                        metadata={"plate": plate, "doc": critical_doc_type, "expiry": expiry_str}
                    )

                    tg_msg = (
                        f"✅ <b>TRANSPORT BLOKDAN CHIQARILDI</b>\n\n"
                        f"🚗 <b>Davlat raqami:</b> <code>{plate}</code>\n"
                        f"🏢 <b>Korxona:</b> {company_name}\n"
                        f"📋 <b>Hujjat:</b> {critical_doc_type or 'Muvofiqlik tiklandi'}\n"
                        f"🟢 <b>Holat:</b> Yo'l varaqasi berishga ruxsat etildi."
                    )
                    telegram.send_alert(tg_msg)

        self.conn.commit()
        cur.close()

        logger.info("--------------------------------------------------")
        logger.info(f"TAHLIL NATIJALARI ({self.mode.upper()}):")
        logger.info(f"  Jami tekshirildi: {stats['total']}")
        logger.info(f"  Qonuniy va xavfsiz: {stats['compliant']}")
        logger.info(f"  3 kunlik ogohlantirishda: {stats['warning']}")
        logger.info(f"  Muddati o'tib bloklangan: {stats['blocked']}")
        logger.info(f"  Qo'lda ruxsat (Override): {stats['overridden']}")
        logger.info(f"  Yangi blokdan ochilgan: {stats['unblocked']}")
        logger.info("--------------------------------------------------")

    def _create_system_alert(
        self,
        cur,
        tenant_id: str,
        vehicle_id: str,
        alert_type: str,
        severity: str,
        title: str,
        message: str,
        metadata: Dict[str, Any]
    ):
        """SystemAlert jadvaliga yozish va deduping (oxirgi 24 soat ichida takrorlanmaslik)."""
        cur.execute("""
            SELECT id FROM "SystemAlert"
            WHERE "tenantId" = %s AND "vehicleId" = %s AND type = %s::"AlertType" AND title = %s
              AND "createdAt" > (CURRENT_TIMESTAMP - INTERVAL '24 hours')
            LIMIT 1;
        """, (tenant_id, vehicle_id, alert_type, title))

        if cur.fetchone():
            return  # So'nggi 24 soatda yozilgan, takrorlamaymiz

        alert_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO "SystemAlert" (
                id, "tenantId", "vehicleId", type, severity, title, message, metadata, "isResolved", "createdAt"
            ) VALUES (
                %s, %s, %s, %s::"AlertType", %s::"AlertSeverity", %s, %s, %s, false, CURRENT_TIMESTAMP
            );
        """, (
            alert_id,
            tenant_id,
            vehicle_id,
            alert_type,
            severity,
            title,
            message,
            json.dumps(metadata)
        ))


def main():
    parser = argparse.ArgumentParser(description="24/7 Hybrid State Sync Daemon")
    parser.add_argument(
        "--deep",
        action="store_true",
        help="To'liq tungi sinxronizatsiya (barcha 385+ transportlar bo'yicha to'liq portallar va baza tekshiruvi)"
    )
    parser.add_argument(
        "--delta",
        action="store_true",
        help="4 soatlik tezkor sinxronizatsiya (muddati <= 7 kun qolganlar va token yangilash)"
    )

    args = parser.parse_args()
    mode = "deep" if args.deep else "delta"

    daemon = HybridStateSyncDaemon(mode=mode)
    daemon.run()


if __name__ == "__main__":
    main()
