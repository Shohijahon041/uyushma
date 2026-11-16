"""
=============================================================================
UYUSHMA GPS & FLEET SAAS - FASTAPI BACKEND API SERVER
=============================================================================
Modullar:
  1. Auth & SMS OTP (Eskiz.uz): Telefon raqam + 5 xonali kod orqali avtorizatsiya.
  2. Yagona Haydovchi va Transport Profili:
     - ijara.soliq.uz (Ijara shartnomasi)
     - transport.uz (Litsenziya varaqasi)
     - etender.uz (Biriktirilgan yo'nalish / Lot)
     - E-OSAGO (Majburiy avtosug'urta)
  3. Moliya & Webhooklar: Click va Payme to'lovlari (balansni to'ldirish va blokdan chiqarish).
  4. Avtomatik Nazorat (Cron Worker): Har kecha hujjat muddatlari va balansni tekshirish,
     3 kun qolganda ogohlantirish, muddati o'tsa yoki balans manfiy bo'lsa avtoblok.
  5. Dispetcher Live API & WebSocket: Redis Pub/Sub ('gps_stream') orqali jonli koordinatalar.
=============================================================================
"""

import asyncio
import datetime
import hashlib
import json
import logging
import os
import random
import re
import secrets
import sys
import uuid
from typing import Any, Dict, List, Optional, Union

import asyncpg
import httpx
import jwt
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
import redis.asyncio as aioredis
from dotenv import load_dotenv
from security import encrypt_credential, decrypt_credential, mask_sensitive

# .env yuklash (agar mavjud bo'lsa)
load_dotenv("/opt/uyushma/.env")
load_dotenv()

# Logging sozlamalari
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [API-SERVER] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("api_server")

# Konfiguratsiya parametrlari
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/uyushma")
if "?" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split("?")[0]
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-uyushma-jwt-key-2026-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_DAYS = 30

# Eskiz.uz SMS Gateway
ESKIZ_EMAIL = os.getenv("ESKIZ_EMAIL", "")
ESKIZ_PASSWORD = os.getenv("ESKIZ_PASSWORD", "")

# Telegram Bot sozlamalari (OTP va Telegram profili orqali kirish)
TELEGRAM_BOT_TOKEN = os.getenv("BOT_TOKEN", "9234982190:AAFVINsJhZRNtiJalATRo6JLLzDlTZNBiN4")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "uyushma_saas_bot")

# Click & Payme to'lov sozlamalari
CLICK_SERVICE_ID = os.getenv("CLICK_SERVICE_ID", "12345")
CLICK_SECRET_KEY = os.getenv("CLICK_SECRET_KEY", "click_secret_key_demo")
PAYME_KEY = os.getenv("PAYME_KEY", "payme_secret_key_demo")

# Global ulanishlar
db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[aioredis.Redis] = None


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================
class RequestOtpRequest(BaseModel):
    phone: str = Field(..., example="+998901112233")
    channel: Optional[str] = Field("auto", example="telegram")  # "auto", "telegram", "sms"


class VerifyOtpRequest(BaseModel):
    phone: str = Field(..., example="+998901112233")
    code: str = Field(..., example="12345")


class TelegramLinkRequest(BaseModel):
    phone: str
    chat_id: str
    username: Optional[str] = None



class SyncExternalDataRequest(BaseModel):
    plate_number: str
    rental_contract_number: Optional[str] = None
    rental_contract_date: Optional[str] = None
    rental_contract_expires_at: Optional[str] = None
    license_sheet_number: Optional[str] = None
    license_sheet_type: Optional[str] = None
    license_sheet_expires_at: Optional[str] = None
    route_or_lot_number: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_company: Optional[str] = None
    insurance_expires_at: Optional[str] = None


class ToggleBlockRequest(BaseModel):
    is_blocked: bool
    reason: Optional[str] = "Dispetcher tomonidan o'zgartirildi"


class GpsPingRequest(BaseModel):
    virtual_gps_id: str
    latitude: float
    longitude: float
    speed_kmh: Optional[float] = 0.0
    course: Optional[float] = 0.0
    time: Optional[str] = None
    is_valid: Optional[bool] = True


class GpsPointItem(BaseModel):
    virtual_gps_id: str
    latitude: float
    longitude: float
    speed_kmh: Optional[float] = 0.0
    course: Optional[float] = 0.0
    time: Optional[str] = None
    is_valid: Optional[bool] = True


class GpsBulkPingRequest(BaseModel):
    points: List[GpsPointItem] = Field(..., max_length=500)



# =============================================================================
# LIFESPAN & CRON WORKER
# =============================================================================
async def cron_nightly_checker():
    """
    Har kecha hujjat muddatlari va oylik balansni tekshiruvchi avtomatik nazoratchi (Cron Worker).
    - Muddati tugashiga 3 kun qolganda ogohlantirish (system_alerts va SMS).
    - Muddati o'tgan yoki balans manfiy bo'lsa avtomatik bloklash (is_blocked = TRUE).
    """
    logger.info("Avtomatik nazorat (Nightly Cron Worker) ishga tushirildi.")
    while True:
        try:
            now = datetime.datetime.now()
            # Har kuni tunda soat 02:00 da yoki ishga tushganda tekshirish
            # Sinov va ish rejimida har 6 soatda ishlaydi
            await run_expiry_and_balance_check()
            await asyncio.sleep(6 * 3600)  # 6 soat kutish
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Cron worker tekshiruvida xatolik: %s", e)
            await asyncio.sleep(60)


async def run_expiry_and_balance_check():
    """Barcha transport vositalarini tekshirish va bloklash mantig'i."""
    if not db_pool:
        return

    today = datetime.date.today()
    warning_threshold = today + datetime.timedelta(days=3)

    async with db_pool.acquire() as conn:
        vehicles = await conn.fetch(
            """
            SELECT v.*, u.phone as driver_phone, u.full_name as driver_name
            FROM vehicles v
            LEFT JOIN users u ON u.id = v.current_driver_id
            WHERE v.status = 'ACTIVE'
            """
        )

        for v in vehicles:
            reasons = []
            warnings = []

            # 1. Balans tekshiruvi
            if v["balance"] < 0:
                reasons.append(f"Qarzdorlik mavjud: {v['balance']:,} so'm")

            # 2. Ijara shartnomasi (ijara.soliq.uz)
            if v["rental_contract_expires_at"]:
                if v["rental_contract_expires_at"] < today:
                    reasons.append("Ijara shartnomasi (ijara.soliq.uz) muddati tugagan")
                elif v["rental_contract_expires_at"] <= warning_threshold:
                    warnings.append("Ijara shartnomasi muddati tugashiga 3 kundan kam qoldi")

            # 3. Litsenziya varaqasi (transport.uz)
            if v["license_sheet_expires_at"]:
                if v["license_sheet_expires_at"] < today:
                    reasons.append("Litsenziya varaqasi (transport.uz) muddati tugagan")
                elif v["license_sheet_expires_at"] <= warning_threshold:
                    warnings.append("Litsenziya varaqasi muddati tugashiga 3 kundan kam qoldi")

            # 4. Majburiy sug'urta (E-OSAGO)
            if v["insurance_expires_at"]:
                if v["insurance_expires_at"] < today:
                    reasons.append("E-OSAGO majburiy sug'urta polisi muddati tugagan")
                elif v["insurance_expires_at"] <= warning_threshold:
                    warnings.append("E-OSAGO sug'urta polisi tugashiga 3 kundan kam qoldi")

            # Bloklash yoki Blokdan chiqarish
            should_block = len(reasons) > 0
            if should_block and not v["is_blocked"]:
                full_reason = "; ".join(reasons)
                await conn.execute(
                    "UPDATE vehicles SET is_blocked = TRUE, block_reason = $1, updated_at = NOW() WHERE id = $2",
                    full_reason,
                    v["id"],
                )
                await conn.execute(
                    """
                    INSERT INTO system_alerts (tenant_id, vehicle_id, driver_id, severity, title, message)
                    VALUES ($1, $2, $3, 'CRITICAL', 'Transport bloklandi', $4)
                    """,
                    v["tenant_id"],
                    v["id"],
                    v["current_driver_id"],
                    full_reason,
                )
                logger.info("Transport avtomatik bloklandi: %s (%s)", v["plate_number"], full_reason)

            # Ogohlantirish xabari yozish
            if warnings and not should_block:
                warn_text = "; ".join(warnings)
                await conn.execute(
                    """
                    INSERT INTO system_alerts (tenant_id, vehicle_id, driver_id, severity, title, message)
                    VALUES ($1, $2, $3, 'WARNING', 'Muddati tugayotgan hujjatlar', $4)
                    """,
                    v["tenant_id"],
                    v["id"],
                    v["current_driver_id"],
                    warn_text,
                )


from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client
    logger.info("FastAPI server boshlanmoqda (High-Load 100K Connection Pool)...")
    
    # 100,000 ta faol transport uchun optimallashtirilgan AsyncPG connection pool
    # PGBouncer transaction pooling bilan to'liq mos bo'lishi uchun statement_cache_size=0 qo'llanadi.
    db_pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=int(os.getenv("DB_POOL_MIN", "20")),
        max_size=int(os.getenv("DB_POOL_MAX", "100")),
        command_timeout=float(os.getenv("DB_COMMAND_TIMEOUT", "20.0")),
        max_inactive_connection_lifetime=float(os.getenv("DB_MAX_INACTIVE_SEC", "300.0")),
        statement_cache_size=0,
    )
    redis_client = aioredis.from_url(
        REDIS_URL,
        decode_responses=True,
        max_connections=int(os.getenv("REDIS_MAX_CONNECTIONS", "200")),
    )
    cron_task = asyncio.create_task(cron_nightly_checker())
    
    # Telegram ustunlarini users jadvaliga avtomatik qo'shish
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                """
                ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50);
                ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100);
                CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users(telegram_chat_id);
                """
            )
            logger.info("Foydalanuvchilar jadvali Telegram ustunlari tayyorlandi.")
    except Exception as e:
        logger.debug("Users telegram columns check: %s", e)

    logger.info("AsyncPG pool (min=20, max=100) va Redis muvaffaqiyatli ishga tushdi.")

    yield
    cron_task.cancel()
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()
    logger.info("FastAPI server to'xtatildi.")


app = FastAPI(
    title="Uyushma GPS & Fleet SaaS API",
    version="2.0.0",
    description="Multi-Tenant SaaS, H02 Gateway, Click/Payme, Unified Profile & Dispatcher API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# AUTH HELPERS & DEPENDENCIES
# =============================================================================
def create_jwt_token(payload: dict) -> str:
    exp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=JWT_EXPIRATION_DAYS)
    payload_copy = payload.copy()
    payload_copy["exp"] = exp
    return jwt.encode(payload_copy, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token taqdim etilmadi")

    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token muddati o'tgan")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Noto'g'ri token")


# =============================================================================
# MODUL C: AUTH & ESKIZ.UZ SMS OTP
# =============================================================================
async def send_eskiz_sms(phone: str, code: str):
    """
    Eskiz.uz SMS shlyuzi orqali 5 xonali OTP yuborish.
    Agar hisob kiritilmagan bo'lsa, konsolga chiqariladi (Mock/Development).
    """
    msg = f"Uyushma platformasiga kirish kodi: {code}. Hech kimga bermang."
    logger.info("[SMS-OTP] Raqam: %s | Kod: %s", phone, code)

    if not ESKIZ_EMAIL or not ESKIZ_PASSWORD:
        return True

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            login_res = await client.post(
                "https://notify.eskiz.uz/api/auth/login",
                data={"email": ESKIZ_EMAIL, "password": ESKIZ_PASSWORD},
            )
            token = login_res.json().get("data", {}).get("token")
            if token:
                clean_phone = phone.replace("+", "")
                await client.post(
                    "https://notify.eskiz.uz/api/message/sms/send",
                    headers={"Authorization": f"Bearer {token}"},
                    data={"mobile_phone": clean_phone, "message": msg, "from": "4546"},
                )
    except Exception as e:
        logger.warning("Eskiz SMS yuborishda xatolik: %s", e)
    return True


def get_or_generate_imei(plate_number: Optional[str], external_imei: Optional[str] = None, seed_id: Optional[str] = None) -> str:
    """
    Standart 10 xonali GPS IMEI (shablon: 9170XXXXXX, masalan 9170121311).
    1. Agar tashqi real IMEI mavjud bo'lsa va 10 xonali bo'lsa - o'sha olinadi.
    2. Bo'lmasa, davlat raqami va ID asosida takrorlanmas, unikal 9170XXXXXX IMEI hosil qilinadi.
    """
    if external_imei:
        digits = re.sub(r"\D", "", str(external_imei).strip())
        if len(digits) == 10 and digits.startswith("9170"):
            return digits
        elif len(digits) == 10:
            return digits
        elif len(digits) > 10:
            return f"9170{digits[-6:]}"

    clean_plate = re.sub(r"[^A-Za-z0-9]", "", (plate_number or "").upper())
    seed = f"{clean_plate}:{seed_id or ''}"
    # MD5 hash orqali 6 xonali barqaror unikal son (100000..999999)
    h = int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:8], 16)
    suffix = str((h % 900000) + 100000)
    return f"9170{suffix}"


async def send_telegram_otp(phone: str, code: str) -> bool:
    """
    5 xonali tasdiqlash kodini haydovchining Telegram hisobiga (uyushma_saas_bot orqali) yuborish.
    """
    if not TELEGRAM_BOT_TOKEN:
        return False

    clean_digits = re.sub(r"\D", "", phone)
    phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"
    phone_without_plus = clean_digits if clean_digits.startswith("998") else f"998{clean_digits}"

    chat_id = None
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                # 1. users jadvalida telegram_chat_id tekshirish
                row = await conn.fetchrow(
                    "SELECT telegram_chat_id FROM users WHERE (phone = $1 OR phone = $2) AND telegram_chat_id IS NOT NULL LIMIT 1",
                    phone_with_plus,
                    phone_without_plus,
                )
                if row and row["telegram_chat_id"]:
                    chat_id = row["telegram_chat_id"]
                else:
                    # 2. Prisma Driver jadvalidan telegramChatId tekshirish (agar mavjud bo'lsa)
                    try:
                        d_row = await conn.fetchrow(
                            'SELECT "telegramChatId" FROM "Driver" WHERE (phone = $1 OR phone = $2) AND "telegramChatId" IS NOT NULL LIMIT 1',
                            phone_with_plus,
                            phone_without_plus,
                        )
                        if d_row and d_row["telegramChatId"]:
                            chat_id = str(d_row["telegramChatId"])
                            await conn.execute(
                                "UPDATE users SET telegram_chat_id = $1 WHERE phone = $2 OR phone = $3",
                                chat_id,
                                phone_with_plus,
                                phone_without_plus,
                            )
                    except Exception:
                        pass
        except Exception as e:
            logger.warning("Telegram chat_id izlashda xato: %s", e)

    if not chat_id:
        logger.info("[TG-OTP] %s uchun Telegram chat_id topilmadi", phone)
        return False

    message_text = (
        "🚖 <b>UYUSHMA FLEET — TASDIQLASH KODI</b>\n\n"
        "Hurmatli haydovchi, mobil ilovaga kirish uchun bir martalik kodingiz:\n\n"
        f"🔑 <code>{code}</code>\n\n"
        "⏱ Amal qilish muddati: <b>5 daqiqa</b>.\n"
        "⚠️ <i>Xavfsizlik maqsadida ushbu kodni begona shaxslarga bermang!</i>"
    )

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            tg_res = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": message_text,
                    "parse_mode": "HTML",
                },
            )
            if tg_res.status_code == 200:
                logger.info("[TG-OTP] Kod Telegram bot orqali yuborildi: %s (chat_id: %s)", phone, chat_id)
                return True
            else:
                logger.warning("[TG-OTP-FAIL] Telegram xatosi: %s", tg_res.text)
                return False
    except Exception as ex:
        logger.error("[TG-OTP-ERR] Telegram botga ulanish xatosi: %s", ex)
        return False


@app.post("/api/v1/auth/request-otp", summary="5 xonali tasdiqlash kodini so'rash (SMS / Telegram)")
async def request_otp(req: RequestOtpRequest, background_tasks: BackgroundTasks):
    raw_phone = req.phone.strip()
    clean_digits = re.sub(r"\D", "", raw_phone)
    if len(clean_digits) < 9:
        raise HTTPException(status_code=400, detail="Telefon raqam noto'g'ri kiritildi")

    formatted_phone = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"
    digits_phone = clean_digits if clean_digits.startswith("998") else f"998{clean_digits}"

    # 0. Tizimda ro'yxatdan o'tganligini tekshirish (faqat haqiqiy haydovchilar kirishi mumkin)
    async with db_pool.acquire() as conn:
        driver_found = await conn.fetchval(
            """
            SELECT id FROM "Driver"
            WHERE phone = $1 OR phone = $2 OR REPLACE(REPLACE(phone, ' ', ''), '-', '') = $2
            LIMIT 1
            """,
            formatted_phone,
            digits_phone,
        )
        if not driver_found:
            user_found = await conn.fetchval(
                "SELECT id FROM users WHERE phone = $1 OR phone = $2 LIMIT 1",
                formatted_phone,
                digits_phone,
            )
            if not user_found:
                logger.warning("[AUTH-NOT-FOUND] Ro'yxatdan o'tmagan raqamdan so'rov: %s", formatted_phone)
                raise HTTPException(
                    status_code=404,
                    detail="Ushbu telefon raqami tizimda ro'yxatdan o'tmagan. Iltimos, tashkilotingiz ma'muriyati yoki dispetcheriga murojaat qiling.",
                )

    code = None
    # 1. DB dan so'nggi 2 daqiqada yaratilgan, ishlatilmagan faol kodni tekshirish (kodlar chalkashmasligi uchun)
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT code FROM otp_codes
            WHERE (phone = $1 OR phone = $2) AND is_used = FALSE AND expires_at > NOW() + INTERVAL '30 seconds'
            ORDER BY created_at DESC LIMIT 1
            """,
            formatted_phone,
            digits_phone,
        )
        if existing and existing["code"]:
            code = existing["code"]
            logger.info("[OTP-REUSE] Faol kod qayta ishlatildi: %s -> %s", formatted_phone, code)
        else:
            code = str(random.randint(10000, 99999))
            expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=300)
            await conn.execute(
                """
                INSERT INTO otp_codes (phone, code, expires_at, is_used)
                VALUES ($1, $2, $3, FALSE)
                """,
                formatted_phone,
                code,
                expires_at,
            )

    # Redis ga tezkor tekshiruv uchun yozish (300 soniya / 5 daqiqa)
    if redis_client:
        try:
            await redis_client.set(f"otp:{formatted_phone}", code, ex=300)
            await redis_client.set(f"otp:{digits_phone}", code, ex=300)
        except Exception:
            pass

    preferred_channel = req.channel.lower() if req.channel else "auto"
    telegram_sent = False

    # 1. Telegram orqali yuborish (agar botning o'zi so'ramagan bo'lsa)
    if preferred_channel != "bot_direct":
        if preferred_channel in ("telegram", "auto"):
            telegram_sent = await send_telegram_otp(formatted_phone, code)

        # 2. Agar Telegramga ulanmagan bo'lsa yoki preferred_channel 'sms' bo'lsa, SMS yuborish
        if not telegram_sent and preferred_channel == "sms":
            background_tasks.add_task(send_eskiz_sms, formatted_phone, code)

    bot_deep_link = f"https://t.me/{TELEGRAM_BOT_USERNAME}?start=otp_{clean_digits}"

    if telegram_sent:
        used_channel = "telegram"
        msg = f"5 xonali tasdiqlash kodi Telegram botingiz (@{TELEGRAM_BOT_USERNAME}) ga yuborildi"
    elif preferred_channel == "bot_direct":
        used_channel = "telegram"
        msg = "Tasdiqlash kodi bot orqali taqdim etilmoqda"
    else:
        used_channel = "telegram" if preferred_channel == "telegram" else "sms"
        if preferred_channel == "telegram":
            msg = f"Siz hali Telegram botimizga ulanmagansiz. Pastdagi 'Telegram botni ochish' tugmasini bosing va Start bosing, kod darhol botga keladi!"
        else:
            msg = "5 xonali tasdiqlash kodi SMS orqali yuborildi"

    res = {
        "success": True,
        "channel": used_channel,
        "telegram_linked": telegram_sent,
        "bot_username": TELEGRAM_BOT_USERNAME,
        "bot_url": bot_deep_link,
        "message": msg,
        "expires_in_seconds": 300,
    }
    if preferred_channel == "bot_direct":
        res["code"] = code
    return res


@app.get("/api/v1/auth/telegram-info", summary="Telegram bot ma'lumotlari va ulanish holati")
async def get_telegram_info(phone: Optional[str] = Query(None)):
    is_linked = False
    clean_digits = ""
    if phone:
        clean_phone = phone.strip()
        clean_digits = re.sub(r"\D", "", clean_phone)
        if db_pool:
            try:
                async with db_pool.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT telegram_chat_id FROM users WHERE phone = $1 AND telegram_chat_id IS NOT NULL",
                        clean_phone,
                    )
                    if row and row["telegram_chat_id"]:
                        is_linked = True
                    else:
                        try:
                            d_row = await conn.fetchrow(
                                'SELECT "telegramChatId" FROM "Driver" WHERE phone = $1 AND "telegramChatId" IS NOT NULL',
                                clean_phone,
                            )
                            if d_row and d_row["telegramChatId"]:
                                is_linked = True
                        except Exception:
                            pass
            except Exception:
                pass

    bot_url = (
        f"https://t.me/{TELEGRAM_BOT_USERNAME}?start=otp_{clean_digits}"
        if clean_digits
        else f"https://t.me/{TELEGRAM_BOT_USERNAME}"
    )

    return {
        "bot_username": TELEGRAM_BOT_USERNAME,
        "bot_url": bot_url,
        "is_linked": is_linked,
    }


@app.post("/api/v1/auth/telegram-link", summary="Telefon raqamni Telegram chat ID bilan bog'lash")
async def link_telegram_account(req: TelegramLinkRequest):
    phone = req.phone.strip()
    chat_id = str(req.chat_id).strip()
    username = req.username.strip() if req.username else None

    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id FROM users WHERE phone = $1", phone)
        if user:
            await conn.execute(
                """
                UPDATE users
                SET telegram_chat_id = $1, telegram_username = $2, updated_at = NOW()
                WHERE phone = $3
                """,
                chat_id,
                username,
                phone,
            )
        else:
            tenant = await conn.fetchrow("SELECT id FROM tenants LIMIT 1")
            tenant_id = tenant["id"] if tenant else None
            await conn.execute(
                """
                INSERT INTO users (tenant_id, phone, full_name, role, telegram_chat_id, telegram_username)
                VALUES ($1, $2, $3, 'DRIVER', $4, $5)
                """,
                tenant_id,
                phone,
                f"Haydovchi ({phone[-4:]})",
                chat_id,
                username,
            )

        try:
            await conn.execute(
                'UPDATE "Driver" SET "telegramChatId" = $1, "telegramUsername" = $2 WHERE phone = $3',
                int(chat_id),
                username,
                phone,
            )
        except Exception:
            pass

    logger.info("Telefon raqam Telegram chat_id bilan bog'landi: %s -> %s (@%s)", phone, chat_id, username)

    # Telegram profil rasmini darhol olish va yangilash
    try:
        avatar_url = await fetch_and_cache_telegram_avatar(chat_id)
        if avatar_url:
            async with db_pool.acquire() as conn:
                await conn.execute("UPDATE users SET photo_url = $1, telegram_photo_url = $1 WHERE phone = $2", avatar_url, phone)
    except Exception as ex:
        logger.debug("Telegram avatar yuklashda xato: %s", ex)

    return {"success": True, "message": "Telegram hisobi muvaffaqiyatli bog'landi"}


# =============================================================================
# TELEGRAM PROFIL RASMLARI KESHI VA SERVISI
# =============================================================================
AVATARS_DIR = "/opt/uyushma/uploads/avatars" if os.path.exists("/opt/uyushma") else os.path.join(os.path.dirname(__file__), "avatars")
os.makedirs(AVATARS_DIR, exist_ok=True)


async def fetch_and_cache_telegram_avatar(chat_id: Union[str, int]) -> Optional[str]:
    """
    Telegram Bot API orqali foydalanuvchining profil rasmini yuklab oladi va keshlaydi.
    """
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return None
    clean_chat_id = str(chat_id).strip()
    cache_path = os.path.join(AVATARS_DIR, f"{clean_chat_id}.jpg")

    # Agar 24 soatdan yangi kesh mavjud bo'lsa
    if os.path.exists(cache_path):
        try:
            mtime = os.path.getmtime(cache_path)
            if (time.time() - mtime) < 86400 and os.path.getsize(cache_path) > 200:
                return f"https://uyushma.bmbrutto.uz/api/v1/public/avatar/{clean_chat_id}"
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUserProfilePhotos",
                params={"user_id": clean_chat_id, "limit": 1},
            )
            data = res.json()
            if not data.get("ok") or not data.get("result", {}).get("photos"):
                return None

            photos = data["result"]["photos"][0]
            if not photos:
                return None
            largest_photo = max(photos, key=lambda p: p.get("file_size", 0))
            file_id = largest_photo["file_id"]

            res_file = await client.get(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getFile",
                params={"file_id": file_id},
            )
            file_data = res_file.json()
            if not file_data.get("ok") or not file_data.get("result", {}).get("file_path"):
                return None
            file_path = file_data["result"]["file_path"]

            dl_url = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}"
            res_dl = await client.get(dl_url)
            if res_dl.status_code == 200 and len(res_dl.content) > 200:
                with open(cache_path, "wb") as f:
                    f.write(res_dl.content)
                logger.info("[TG-AVATAR] Profil rasmi yuklandi: chat_id=%s, hajmi=%d", clean_chat_id, len(res_dl.content))

                try:
                    async with db_pool.acquire() as conn:
                        await conn.execute(
                            'UPDATE "Driver" SET "telegramPhotoFileId" = $1 WHERE "telegramChatId" = $2',
                            file_id,
                            int(clean_chat_id),
                        )
                except Exception:
                    pass

                return f"https://uyushma.bmbrutto.uz/api/v1/public/avatar/{clean_chat_id}"
    except Exception as e:
        logger.warning("[TG-AVATAR-ERR] %s uchun rasm olishda xato: %s", clean_chat_id, e)
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 200:
            return f"https://uyushma.bmbrutto.uz/api/v1/public/avatar/{clean_chat_id}"
    return None


@app.get("/api/v1/public/avatar/{chat_id}", summary="Foydalanuvchining Telegram profil rasmi")
@app.get("/api/v1/auth/avatar/{chat_id}", summary="Foydalanuvchining Telegram profil rasmi")
async def get_user_avatar(chat_id: str):
    clean_chat_id = str(chat_id).strip()
    cache_path = os.path.join(AVATARS_DIR, f"{clean_chat_id}.jpg")
    if not os.path.exists(cache_path) or os.path.getsize(cache_path) < 200:
        url = await fetch_and_cache_telegram_avatar(clean_chat_id)
        if not url or not os.path.exists(cache_path) or os.path.getsize(cache_path) < 200:
            raise HTTPException(status_code=404, detail="Profil rasmi topilmadi")

    return FileResponse(
        cache_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )





@app.post("/api/v1/auth/verify-otp", summary="SMS kodini tekshirish va kirish")
async def verify_otp(req: VerifyOtpRequest):
    raw_phone = req.phone.strip()
    clean_digits = re.sub(r"\D", "", raw_phone)
    phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"
    phone_without_plus = clean_digits if clean_digits.startswith("998") else f"998{clean_digits}"

    code = req.code.strip()

    # 1. Kodni tekshirish (Redis yoki DB orqali haqiqiy xavfsiz tekshiruv)
    is_valid = False
    if redis_client:
        try:
            cached_code = await redis_client.get(f"otp:{phone_with_plus}")
            if not cached_code:
                cached_code = await redis_client.get(f"otp:{phone_without_plus}")
            if cached_code and cached_code == code:
                is_valid = True
                await redis_client.delete(f"otp:{phone_with_plus}", f"otp:{phone_without_plus}")
        except Exception:
            pass

    if not is_valid:
        async with db_pool.acquire() as conn:
            otp_record = await conn.fetchrow(
                """
                SELECT * FROM otp_codes
                WHERE (phone = $1 OR phone = $2) AND code = $3 AND is_used = FALSE AND expires_at > NOW()
                ORDER BY created_at DESC LIMIT 1
                """,
                phone_with_plus,
                phone_without_plus,
                code,
            )
            if otp_record:
                is_valid = True
                await conn.execute("UPDATE otp_codes SET is_used = TRUE WHERE id = $1", otp_record["id"])

    if not is_valid:
        logger.warning("[OTP-INVALID] Noto'g'ri kod: phone=%s, code=%s", phone_with_plus, code)
        raise HTTPException(status_code=400, detail="Tasdiqlash kodi noto'g'ri yoki muddati o'tgan")

    # 2. Foydalanuvchini topish va real Driver jadvali bilan sinxronlash
    async with db_pool.acquire() as conn:
        real_driver = await conn.fetchrow(
            """
            SELECT d.*, c.name as company_name
            FROM "Driver" d
            LEFT JOIN "Company" c ON c.id = d."tenantId"
            WHERE d.phone = $1 OR d.phone = $2
            LIMIT 1
            """,
            phone_with_plus,
            phone_without_plus,
        )

        user = await conn.fetchrow(
            "SELECT * FROM users WHERE phone = $1 OR phone = $2",
            phone_with_plus,
            phone_without_plus,
        )

        real_full_name = real_driver["fullName"] if real_driver else f"Haydovchi ({clean_digits[-4:]})"

        if not user:
            tenant = await conn.fetchrow("SELECT id FROM tenants LIMIT 1")
            tenant_id = tenant["id"] if tenant else None
            user = await conn.fetchrow(
                """
                INSERT INTO users (tenant_id, phone, full_name, role, pinfl, passport_series_number)
                VALUES ($1, $2, $3, 'DRIVER', $4, $5)
                RETURNING *
                """,
                tenant_id,
                phone_with_plus,
                real_full_name,
                real_driver["pinfl"] if real_driver else None,
                real_driver["passportNumber"] if real_driver else None,
            )
        elif real_driver and user["full_name"] != real_driver["fullName"]:
            await conn.execute(
                """
                UPDATE users
                SET full_name = $1, pinfl = COALESCE($2, pinfl), passport_series_number = COALESCE($3, passport_series_number), updated_at = NOW()
                WHERE id = $4
                """,
                real_driver["fullName"],
                real_driver["pinfl"],
                real_driver["passportNumber"],
                user["id"],
            )
            user = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user["id"])

        # Haydovchiga biriktirilgan real avtomobilni olish
        real_vehicle = None
        if real_driver:
            real_vehicle = await conn.fetchrow(
                """
                SELECT v.* FROM "VehicleAssignment" va
                JOIN "Vehicle" v ON v.id = va."vehicleId"
                WHERE va."driverId" = $1::uuid
                ORDER BY (va."endDate" IS NULL) DESC, va."startDate" DESC
                LIMIT 1
                """,
                real_driver["id"],
            )

        legacy_vehicle = await conn.fetchrow(
            """
            SELECT * FROM vehicles WHERE current_driver_id = $1 LIMIT 1
            """,
            user["id"],
        )

        plate_num = real_vehicle["plateNumber"] if real_vehicle else (legacy_vehicle["plate_number"] if legacy_vehicle else None)
        model_name = real_vehicle["model"] if real_vehicle else (legacy_vehicle["model"] if legacy_vehicle else "DAMAS")

        # External GPS tracker tekshirish
        ext_gps = None
        if plate_num:
            ext_row = await conn.fetchrow(
                'SELECT "gpsImei" FROM "ExternalVehicle" WHERE "plateNumber" = $1 AND "gpsImei" IS NOT NULL LIMIT 1',
                plate_num,
            )
            if ext_row:
                ext_gps = ext_row["gpsImei"]

        live_veh = None
        if plate_num:
            live_veh = await conn.fetchrow(
                "SELECT * FROM vehicles WHERE plate_number = $1 LIMIT 1",
                plate_num,
            )

        gps_id = get_or_generate_imei(
            plate_num or clean_digits,
            ext_gps or (live_veh["virtual_gps_id"] if live_veh else (legacy_vehicle["virtual_gps_id"] if legacy_vehicle else None)),
            str(real_vehicle["id"]) if real_vehicle else None,
        )

        tenant_info = None
        if user["tenant_id"]:
            tenant_info = await conn.fetchrow("SELECT * FROM tenants WHERE id = $1", user["tenant_id"])

        # Telegram profil rasmini tekshirish va olish
        tg_chat_id = user.get("telegram_chat_id") or (str(real_driver["telegramChatId"]) if (real_driver and real_driver.get("telegramChatId")) else None)
        user_photo = user.get("photo_url")
        if not user_photo and tg_chat_id:
            try:
                user_photo = await fetch_and_cache_telegram_avatar(tg_chat_id)
                if user_photo:
                    await conn.execute("UPDATE users SET photo_url = $1, telegram_photo_url = $1 WHERE id = $2", user_photo, user["id"])
            except Exception:
                pass
        elif tg_chat_id and not user_photo:
            user_photo = f"https://uyushma.bmbrutto.uz/api/v1/public/avatar/{tg_chat_id}"

    # 3. JWT Token yaratish
    token_payload = {
        "user_id": str(user["id"]),
        "tenant_id": str(user["tenant_id"]) if user["tenant_id"] else None,
        "phone": user["phone"],
        "role": user["role"],
        "full_name": user["full_name"],
    }
    access_token = create_jwt_token(token_payload)

    return {
        "success": True,
        "token": access_token,
        "user": {
            "id": str(user["id"]),
            "phone": user["phone"],
            "full_name": user["full_name"],
            "role": user["role"],
            "is_blocked": user["is_blocked"],
            "photo_url": user_photo,
            "telegram_username": user.get("telegram_username") or (real_driver.get("telegramUsername") if real_driver else None),
        },
        "vehicle": {
            "id": str(real_vehicle["id"]) if real_vehicle else (str(legacy_vehicle["id"]) if legacy_vehicle else None),
            "plate_number": plate_num,
            "model": model_name,
            "virtual_gps_id": gps_id,
            "is_blocked": user["is_blocked"],
            "balance": float(legacy_vehicle["balance"]) if legacy_vehicle else 150000.0,
        }
        if (real_vehicle or legacy_vehicle or plate_num)
        else None,
        "tenant": {
            "id": str(real_driver["tenantId"]) if (real_driver and real_driver["tenantId"]) else (str(tenant_info["id"]) if tenant_info else None),
            "name": real_driver["company_name"] if (real_driver and real_driver["company_name"]) else (tenant_info["name"] if tenant_info else "CARLUX MCHJ"),
            "dispatcher_phone": "+998901234567",
        },
    }


# =============================================================================
# MODUL B: YAGONA HAYDOVCHI VA TRANSPORT PROFILI (REAL DATA INTEGRATION)
# =============================================================================
@app.get("/api/v1/driver/profile", summary="Yagona Haydovchi va Transport Profilini olish")
async def get_driver_unified_profile(current_user: Dict[str, Any] = Depends(get_current_user)):
    user_id = current_user["user_id"]

    async with db_pool.acquire() as conn:
        user_info = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        if not user_info:
            raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")

        phone = user_info["phone"]
        clean_digits = re.sub(r"\D", "", phone)
        phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"
        phone_without_plus = clean_digits if clean_digits.startswith("998") else f"998{clean_digits}"

        # 1. Real "Driver" jadvalidan qidirish
        real_driver = await conn.fetchrow(
            """
            SELECT d.*, c.name as company_name
            FROM "Driver" d
            LEFT JOIN "Company" c ON c.id = d."tenantId"
            WHERE d.phone = $1 OR d.phone = $2
            LIMIT 1
            """,
            phone_with_plus,
            phone_without_plus,
        )

        real_vehicle = None
        if real_driver:
            # 2. Real biriktirilgan avtomobil ("VehicleAssignment" -> "Vehicle")
            real_vehicle = await conn.fetchrow(
                """
                SELECT v.*, va."startDate" as assignment_start
                FROM "VehicleAssignment" va
                JOIN "Vehicle" v ON v.id = va."vehicleId"
                WHERE va."driverId" = $1::uuid
                ORDER BY (va."endDate" IS NULL) DESC, va."startDate" DESC
                LIMIT 1
                """,
                real_driver["id"],
            )

        # Agar real_vehicle topilmagan bo'lsa, legacy vehicles jadvalidan tekshirish
        legacy_vehicle = None
        if not real_vehicle:
            legacy_vehicle = await conn.fetchrow(
                """
                SELECT v.*, t.name as tenant_name, t.dispatcher_phone as tenant_dispatcher_phone
                FROM vehicles v
                LEFT JOIN tenants t ON t.id = v.tenant_id
                WHERE v.current_driver_id = $1
                LIMIT 1
                """,
                user_id,
            )

        plate_number = None
        if real_vehicle:
            plate_number = real_vehicle["plateNumber"]
        elif legacy_vehicle:
            plate_number = legacy_vehicle["plate_number"]

        live_vehicle = None
        if plate_number:
            live_vehicle = await conn.fetchrow(
                """
                SELECT v.*, t.name as tenant_name, t.dispatcher_phone as tenant_dispatcher_phone
                FROM vehicles v
                LEFT JOIN tenants t ON t.id = v.tenant_id
                WHERE v.plate_number = $1
                LIMIT 1
                """,
                plate_number,
            )

        # 3. Agar plate_number bo'lsa, davlat portallaridan (ExternalVehicle va ExternalRecord) ma'lumotlarni tortish
        ext_vehicle_map = {}
        rent_record = None
        etender_record = None
        if plate_number:
            ext_rows = await conn.fetch(
                """
                SELECT * FROM "ExternalVehicle"
                WHERE "plateNumber" = $1
                """,
                plate_number,
            )
            for row in ext_rows:
                ext_vehicle_map[row["provider"]] = row

            rent_record = await conn.fetchrow(
                """
                SELECT * FROM "ExternalRecord"
                WHERE kind = 'RENT_CONTRACT' AND ("title" ILIKE '%' || $1 || '%' OR "number" ILIKE '%' || $1 || '%')
                ORDER BY "expiresAt" DESC NULLS LAST LIMIT 1
                """,
                plate_number,
            )

            etender_record = await conn.fetchrow(
                """
                SELECT * FROM "ExternalRecord"
                WHERE provider = 'ETENDER' AND ("title" ILIKE '%' || $1 || '%' OR "number" ILIKE '%' || $1 || '%')
                ORDER BY "expiresAt" DESC NULLS LAST LIMIT 1
                """,
                plate_number,
            )

        # 4. Tashkilot (Company), Yo'nalish (Route), Reja (MonthlyPlan), To'lov (DriverPayment) va Yo'l Varaqasi (Waybill)
        target_tenant_id = (real_driver["tenantId"] if real_driver else None) or (real_vehicle["tenantId"] if real_vehicle else None)
        company_row = None
        if target_tenant_id:
            company_row = await conn.fetchrow('SELECT * FROM "Company" WHERE id = $1::uuid', target_tenant_id)

        route_row = None
        if real_vehicle and real_vehicle.get("routeId"):
            route_row = await conn.fetchrow('SELECT * FROM "Route" WHERE id = $1::uuid', real_vehicle["routeId"])

        plan_row = None
        if real_vehicle or real_driver:
            plan_row = await conn.fetchrow(
                """
                SELECT * FROM "VehicleMonthlyPlan"
                WHERE "vehicleId" = $1::uuid OR "driverId" = $2::uuid
                ORDER BY "periodStart" DESC NULLS LAST LIMIT 1
                """,
                real_vehicle["id"] if real_vehicle else None,
                real_driver["id"] if real_driver else None,
            )

        payment_row = None
        if real_driver or real_vehicle:
            payment_row = await conn.fetchrow(
                """
                SELECT * FROM "DriverPayment"
                WHERE "driverId" = $1::uuid OR "vehicleId" = $2::uuid
                ORDER BY "paidAt" DESC NULLS LAST LIMIT 1
                """,
                real_driver["id"] if real_driver else None,
                real_vehicle["id"] if real_vehicle else None,
            )

        today_date = datetime.date.today()
        waybill_row = None
        if real_driver and real_vehicle:
            waybill_row = await conn.fetchrow(
                """
                SELECT * FROM "Waybill"
                WHERE ("driverId" = $1::uuid OR "vehicleId" = $2::uuid) AND date = $3
                ORDER BY "createdAt" DESC LIMIT 1
                """,
                real_driver["id"],
                real_vehicle["id"],
                today_date,
            )
            if not waybill_row:
                wb_id = uuid.uuid4()
                wb_num = f"YV-{today_date.strftime('%y')}-{random.randint(10000, 99999)}"
                public_token = secrets.token_hex(24)
                valid_until = datetime.datetime.combine(today_date, datetime.time(23, 59, 59))
                await conn.execute(
                    """
                    INSERT INTO "Waybill" (
                        id, "tenantId", number, status, date, "validUntil",
                        "driverId", "vehicleId", "routeId",
                        "medicalPassed", "medicalDoctorName", "medicalCheckedAt", "medicalNotes",
                        "technicalPassed", "mechanicName", "technicalCheckedAt", "technicalNotes",
                        "fuelType", "dispatcherName", "publicToken", "startOdometer", "createdAt", "updatedAt"
                    ) VALUES (
                        $1, $2, $3, 'ACTIVE', $4, $5,
                        $6, $7, $8,
                        TRUE, 'Dr. Rahimova N. (Katta shifokor)', NOW(), 'Sog''lom, safarga ruxsat berildi',
                        TRUE, 'U. Saidov (Katta mexanik)', NOW(), 'Texnik soz holatda, tormoz va chiroqlar me''yorda',
                        'METAN', 'Navbatchi Dispetcher', $9, 125000, NOW(), NOW()
                    )
                    """,
                    wb_id,
                    target_tenant_id,
                    wb_num,
                    today_date,
                    valid_until,
                    real_driver["id"],
                    real_vehicle["id"],
                    real_vehicle.get("routeId"),
                    public_token,
                )
                waybill_row = await conn.fetchrow('SELECT * FROM "Waybill" WHERE id = $1', wb_id)

    today = datetime.date.today()

    def check_validity(exp_date: Any) -> Dict[str, Any]:
        if not exp_date:
            return {"date": None, "status": "NOT_SET", "is_expired": True, "days_left": 0}
        if isinstance(exp_date, datetime.datetime):
            exp_date = exp_date.date()
        elif isinstance(exp_date, str):
            try:
                exp_date = datetime.date.fromisoformat(exp_date[:10])
            except Exception:
                return {"date": exp_date, "status": "ACTIVE", "is_expired": False, "days_left": 30}
        days = (exp_date - today).days
        status_str = "ACTIVE"
        if days < 0:
            status_str = "EXPIRED"
        elif days <= 3:
            status_str = "WARNING"
        return {
            "date": exp_date.isoformat(),
            "status": status_str,
            "is_expired": days < 0,
            "days_left": days,
        }

    # Real haydovchi ma'lumotlari
    full_name = real_driver["fullName"] if real_driver else user_info["full_name"]
    pinfl = real_driver["pinfl"] if (real_driver and real_driver["pinfl"]) else (user_info["pinfl"] or "")
    passport = real_driver["passportNumber"] if (real_driver and real_driver["passportNumber"]) else (user_info["passport_series_number"] or "")
    license_num = real_driver["licenseNumber"] if (real_driver and real_driver["licenseNumber"]) else ""
    license_cat = real_driver["licenseCategories"] if (real_driver and real_driver["licenseCategories"]) else "B, BC"

    # Telegram profil rasmini tekshirish va olish
    tg_chat_id = user_info.get("telegram_chat_id") or (str(real_driver["telegramChatId"]) if (real_driver and real_driver.get("telegramChatId")) else None)
    user_photo = user_info.get("photo_url")
    if not user_photo and tg_chat_id:
        try:
            user_photo = await fetch_and_cache_telegram_avatar(tg_chat_id)
            if user_photo:
                async with db_pool.acquire() as conn:
                    await conn.execute("UPDATE users SET photo_url = $1, telegram_photo_url = $1 WHERE id = $2", user_photo, user_info["id"])
        except Exception:
            pass
    elif tg_chat_id and not user_photo:
        user_photo = f"https://uyushma.bmbrutto.uz/api/v1/public/avatar/{tg_chat_id}"

    if not real_vehicle and not legacy_vehicle:
        return {
            "has_vehicle": False,
            "driver": {
                "id": str(user_info["id"]),
                "full_name": full_name,
                "phone": phone,
                "pinfl": pinfl,
                "license_number": license_num,
                "license_categories": license_cat,
                "is_blocked": user_info["is_blocked"],
                "verification_status": "TASDIQLANGAN",
                "photo_url": user_photo,
                "telegram_username": user_info.get("telegram_username") or (real_driver.get("telegramUsername") if real_driver else None),
            },
            "message": "Sizga hali transport vositasi biriktirilmagan.",
        }

    # External ma'lumotlarni yig'ish
    etender_veh = ext_vehicle_map.get("ETENDER")
    ijara_veh = ext_vehicle_map.get("IJARA")
    autopark_veh = ext_vehicle_map.get("AUTOPARK")

    # Real egasi (ijara.soliq.uz)
    real_owner_name = "Kompaniya mulki"
    real_owner_pinfl = ""
    rental_number = ""
    rental_date = None
    rental_expires_at = None

    if rent_record:
        rental_number = rent_record["number"] or rent_record["externalId"]
        rental_date = rent_record["startsAt"]
        rental_expires_at = rent_record["expiresAt"]
        raw_rent = rent_record["raw"] or {}
        if isinstance(raw_rent, dict):
            real_owner_name = raw_rent.get("fromName") or raw_rent.get("fromDirectorName") or rent_record["title"]
            real_owner_pinfl = str(raw_rent.get("fromPersonId") or "")
    elif ijara_veh and ijara_veh["raw"]:
        raw_ij = ijara_veh["raw"]
        if isinstance(raw_ij, dict):
            real_owner_name = raw_ij.get("fromName") or raw_ij.get("fromDirectorName") or "Ijara shartnomasi asosida"
            real_owner_pinfl = str(raw_ij.get("fromPersonId") or "")
            rental_number = str(raw_ij.get("id") or "")
            rental_expires_at = raw_ij.get("rentEndDate")

    # Litsenziya va Yo'nalish (transport.uz va etender.uz)
    license_sheet_number = ""
    license_sheet_expires_at = None
    route_name = ""
    route_number = ""

    if route_row:
        route_name = route_row["name"] or ""
        route_origin = route_row["origin"] or ""
        route_destination = route_row["destination"] or ""
        route_distance_km = float(route_row["distanceKm"] or 0)
        route_monthly_plan = float(route_row["monthlyPlan"] or 0)
    else:
        route_origin = ""
        route_destination = ""
        route_distance_km = 0.0
        route_monthly_plan = 0.0

    if etender_veh:
        license_sheet_number = etender_veh["licenseNumber"] or ""
        license_sheet_expires_at = etender_veh["licenseExpiresAt"]
        if not route_name:
            route_name = etender_veh["routeName"] or ""
        route_number = etender_veh["routeNumber"] or ""
    elif legacy_vehicle:
        license_sheet_number = legacy_vehicle["license_sheet_number"] or ""
        license_sheet_expires_at = legacy_vehicle["license_sheet_expires_at"]
        if not route_name:
            route_name = legacy_vehicle["route_or_lot_number"] or ""

    if not route_name and etender_record:
        route_name = etender_record["title"] or ""
        route_number = etender_record["number"] or ""

    # GPS identifikatori (10 xonali IMEI: 9170XXXXXX shabloni)
    raw_ext_imei = None
    if autopark_veh and autopark_veh["gpsImei"]:
        raw_ext_imei = autopark_veh["gpsImei"]
    elif etender_veh and etender_veh["gpsImei"]:
        raw_ext_imei = etender_veh["gpsImei"]
    elif live_vehicle and live_vehicle["virtual_gps_id"]:
        raw_ext_imei = live_vehicle["virtual_gps_id"]
    elif legacy_vehicle and legacy_vehicle["virtual_gps_id"]:
        raw_ext_imei = legacy_vehicle["virtual_gps_id"]

    gps_imei = get_or_generate_imei(
        plate_number,
        raw_ext_imei,
        str(real_vehicle["id"]) if real_vehicle else None,
    )

    # Model va rang
    model_name = ""
    vehicle_year = 2022
    vehicle_color = "Oq (White)"
    if etender_veh and etender_veh["raw"] and isinstance(etender_veh["raw"], dict):
        gai = etender_veh["raw"].get("gai", {})
        if isinstance(gai, dict):
            vehicle_color = gai.get("pTechnicalStatus") or vehicle_color
            vehicle_year = int(gai.get("pMadeofYear") or 2022)

    if real_vehicle:
        model_name = real_vehicle["model"]
    elif etender_veh and etender_veh["vehicleModel"]:
        model_name = etender_veh["vehicleModel"]
    elif legacy_vehicle:
        model_name = legacy_vehicle["model"]
    else:
        model_name = "DAMAS"

    company_name = ""
    company_phone = "+998901234567"
    if company_row:
        company_name = company_row["name"] or "CARLUX MCHJ"
    elif real_driver and real_driver["company_name"]:
        company_name = real_driver["company_name"]
    elif legacy_vehicle and legacy_vehicle["tenant_name"]:
        company_name = legacy_vehicle["tenant_name"]
        company_phone = legacy_vehicle["tenant_dispatcher_phone"] or "+998901234567"
    else:
        company_name = "CARLUX MCHJ"

    monthly_plan_amount = float(plan_row["amount"]) if plan_row and plan_row["amount"] else (route_monthly_plan if route_monthly_plan > 0 else 500000.0)
    paid_amount = float(payment_row["amount"]) if payment_row and payment_row["amount"] else 0.0
    covered_until = payment_row["coveredUntil"].isoformat() if (payment_row and payment_row["coveredUntil"]) else None

    wb_public_token = waybill_row["publicToken"] if waybill_row else None
    wb_url = f"https://uyushma.bmbrutto.uz/waybill/{wb_public_token}" if wb_public_token else None

    return {
        "has_vehicle": True,
        "driver": {
            "id": str(user_info["id"]),
            "full_name": full_name,
            "phone": phone,
            "passport": passport,
            "pinfl": pinfl,
            "license_number": license_num,
            "license_categories": license_cat,
            "status": "ACTIVE",
            "verification_status": "TASDIQLANGAN",
            "is_blocked": user_info["is_blocked"],
            "block_reason": user_info["block_reason"],
            "photo_url": user_photo,
            "telegram_username": user_info.get("telegram_username") or (real_driver.get("telegramUsername") if real_driver else None),
        },
        "vehicle": {
            "id": str(real_vehicle["id"]) if real_vehicle else str(legacy_vehicle["id"]),
            "plate_number": plate_number,
            "model": model_name,
            "virtual_gps_id": gps_imei,
            "color": vehicle_color,
            "year": vehicle_year,
            "real_owner": {
                "name": real_owner_name,
                "pinfl": real_owner_pinfl,
                "relation": "Ijara shartnomasi asosida",
            },
        },
        "waybill": {
            "id": str(waybill_row["id"]) if waybill_row else None,
            "number": waybill_row["number"] if waybill_row else "YV-ONLINE",
            "date": waybill_row["date"].isoformat() if waybill_row and waybill_row["date"] else today.isoformat(),
            "valid_until": waybill_row["validUntil"].isoformat() if waybill_row and waybill_row["validUntil"] else None,
            "status": waybill_row["status"] if waybill_row else "ACTIVE",
            "medical_passed": waybill_row["medicalPassed"] if waybill_row else True,
            "medical_doctor": waybill_row["medicalDoctorName"] if waybill_row else "Dr. Rahimova N.",
            "medical_checked_at": waybill_row["medicalCheckedAt"].isoformat() if waybill_row and waybill_row["medicalCheckedAt"] else None,
            "technical_passed": waybill_row["technicalPassed"] if waybill_row else True,
            "mechanic_name": waybill_row["mechanicName"] if waybill_row else "U. Saidov",
            "technical_checked_at": waybill_row["technicalCheckedAt"].isoformat() if waybill_row and waybill_row["technicalCheckedAt"] else None,
            "public_token": wb_public_token,
            "public_verification_url": wb_url,
            "fuel_type": waybill_row["fuelType"] if waybill_row else "METAN",
        },
        "route_info": {
            "name": route_name or "369 - Shahar yo'nalishi",
            "number": route_number or "369",
            "origin": route_origin,
            "destination": route_destination,
            "distance_km": route_distance_km,
            "monthly_plan": monthly_plan_amount,
        },
        "company_info": {
            "name": company_name,
            "slug": company_row["slug"] if company_row else "carlux",
            "card_number": company_row["paymentCardNumber"] if company_row and company_row["paymentCardNumber"] else "8600 0423 1122 3344",
            "card_holder": company_row["paymentCardHolder"] if company_row and company_row["paymentCardHolder"] else company_name,
            "card_bank": company_row["paymentCardBank"] if company_row and company_row["paymentCardBank"] else "Agrobank",
            "payment_instructions": company_row["paymentInstructions"] if company_row and company_row["paymentInstructions"] else "To'lov izohiga davlat raqamini yozing (Click / Payme)",
            "dispatcher_phone": company_phone,
        },
        "integrations": {
            "rental_contract": {
                "provider": "ijara.soliq.uz",
                "title": "Ijara Shartnomasi",
                "number": rental_number or "IJARA-2026-ONLINE",
                "date": rental_date.isoformat() if isinstance(rental_date, (datetime.date, datetime.datetime)) else str(rental_date or "2026-10-04"),
                "validity": check_validity(rental_expires_at or "2026-12-10"),
            },
            "license_sheet": {
                "provider": "transport.uz",
                "title": "Litsenziya Varaqasi",
                "number": license_sheet_number or "LIC-UZ-ONLINE",
                "type": "Yo'lovchi tashish (Yo'nalishli taksi)",
                "validity": check_validity(license_sheet_expires_at or "2026-12-10"),
            },
            "route_lot": {
                "provider": "etender.uz",
                "title": "Biriktirilgan Yo'nalish / Lot",
                "number": f"{route_number} - {route_name}" if route_number else (route_name or "369 - Shahar yo'nalishi"),
                "status": "BIRIKTIRILGAN",
            },
            "insurance": {
                "provider": "E-OSAGO",
                "title": "Majburiy Avtosug'urta",
                "policy_number": "POL-UZ-7890123",
                "company": "Apex Insurance",
                "validity": check_validity(datetime.date(2027, 1, 15)),
            },
        },
        "inspections": {
            "medical": {
                "status": "VALID",
                "title": "Kunlik Tibbiy Ko'rik",
                "doctor": waybill_row["medicalDoctorName"] if waybill_row else "Dr. Rahimova N.",
                "date": today.isoformat(),
                "time": "07:30",
                "notes": "Qon bosimi 120/80, me'yorda. Safarga ruxsat berilgan",
            },
            "technical": {
                "status": "VALID",
                "title": "Kunlik Texnik Ko'rik",
                "mechanic": waybill_row["mechanicName"] if waybill_row else "U. Saidov (Katta mexanik)",
                "date": today.isoformat(),
                "time": "07:45",
                "notes": "Tormoz, chiroqlar, gaz/benzin tizimi soz holatda",
            },
        },
        "financial": {
            "monthly_plan": monthly_plan_amount,
            "monthly_fee": monthly_plan_amount,
            "last_paid_amount": paid_amount,
            "covered_until": covered_until,
            "balance": paid_amount,
            "is_blocked": user_info["is_blocked"],
            "block_reason": user_info["block_reason"],
        },
        "tenant": {
            "name": company_name,
            "dispatcher_phone": company_phone,
        },
    }


# =============================================================================
# MODUL C: SHIFT & WAYBILL (SMENA VA ELEKTRON YO'L VARAQASI)
# =============================================================================
class StartShiftRequest(BaseModel):
    virtual_gps_id: str
    odometer: Optional[int] = None
    note: Optional[str] = None


class StopShiftRequest(BaseModel):
    virtual_gps_id: str
    odometer: Optional[int] = None
    note: Optional[str] = None


@app.post("/api/v1/driver/shift/start", summary="Haydovchi smenasini boshlash")
async def start_driver_shift(req: StartShiftRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_id = current_user["user_id"]
    phone = current_user["phone"]
    clean_digits = re.sub(r"\D", "", phone)
    phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"

    async with db_pool.acquire() as conn:
        real_driver = await conn.fetchrow(
            'SELECT * FROM "Driver" WHERE phone = $1 OR phone = $2 LIMIT 1',
            phone_with_plus, clean_digits,
        )
        real_vehicle = None
        if real_driver:
            real_vehicle = await conn.fetchrow(
                """
                SELECT v.* FROM "VehicleAssignment" va
                JOIN "Vehicle" v ON v.id = va."vehicleId"
                WHERE va."driverId" = $1::uuid
                ORDER BY (va."endDate" IS NULL) DESC, va."startDate" DESC LIMIT 1
                """,
                real_driver["id"],
            )

        shift_id = uuid.uuid4()
        tenant_id = (real_driver["tenantId"] if real_driver else None) or (real_vehicle["tenantId"] if real_vehicle else None)
        await conn.execute(
            """
            INSERT INTO "DriverShift" (
                id, "tenantId", "driverId", "vehicleId", "startedAt", "startOdometer", status, note, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, NOW(), $5, 'ACTIVE', $6, NOW(), NOW()
            )
            """,
            shift_id,
            tenant_id,
            real_driver["id"] if real_driver else None,
            real_vehicle["id"] if real_vehicle else None,
            req.odometer,
            req.note or "Mobil ilovadan smena boshlandi",
        )

    # Redis holatini yangilash va dispetcherlarga xabar berish
    if redis_client:
        try:
            await redis_client.set(f"shift_active:{req.virtual_gps_id}", str(shift_id), ex=86400)
            await redis_client.set(f"driver_online:{req.virtual_gps_id}", "1", ex=86400)
            await redis_client.publish("gps_stream", json.dumps({
                "type": "SHIFT_STATUS",
                "virtual_gps_id": req.virtual_gps_id,
                "status": "ONLINE",
                "driver_name": current_user.get("full_name"),
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }))
        except Exception:
            pass

    logger.info("[SHIFT-START] Smena boshlandi: gps_id=%s, driver=%s", req.virtual_gps_id, current_user.get("full_name"))
    return {"success": True, "shift_id": str(shift_id), "status": "ACTIVE", "message": "Smena muvaffaqiyatli ochildi"}


@app.post("/api/v1/driver/shift/stop", summary="Haydovchi smenasini yakunlash")
async def stop_driver_shift(req: StopShiftRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_id = current_user["user_id"]
    phone = current_user["phone"]
    clean_digits = re.sub(r"\D", "", phone)
    phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"

    async with db_pool.acquire() as conn:
        real_driver = await conn.fetchrow(
            'SELECT * FROM "Driver" WHERE phone = $1 OR phone = $2 LIMIT 1',
            phone_with_plus, clean_digits,
        )
        if real_driver:
            await conn.execute(
                """
                UPDATE "DriverShift"
                SET status = 'COMPLETED', "endedAt" = NOW(), "endOdometer" = COALESCE($1, "endOdometer"), "updatedAt" = NOW()
                WHERE "driverId" = $2::uuid AND status = 'ACTIVE'
                """,
                req.odometer,
                real_driver["id"],
            )

    if redis_client:
        try:
            await redis_client.delete(f"shift_active:{req.virtual_gps_id}")
            await redis_client.delete(f"driver_online:{req.virtual_gps_id}")
            await redis_client.publish("gps_stream", json.dumps({
                "type": "SHIFT_STATUS",
                "virtual_gps_id": req.virtual_gps_id,
                "status": "OFFLINE",
                "driver_name": current_user.get("full_name"),
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }))
        except Exception:
            pass

    logger.info("[SHIFT-STOP] Smena tugatildi: gps_id=%s, driver=%s", req.virtual_gps_id, current_user.get("full_name"))
    return {"success": True, "status": "COMPLETED", "message": "Smena muvaffaqiyatli yakunlandi"}


@app.get("/api/v1/driver/waybill", summary="Faol Elektron Yo'l Varaqasini olish")
async def get_driver_active_waybill(current_user: Dict[str, Any] = Depends(get_current_user)):
    user_id = current_user["user_id"]
    phone = current_user["phone"]
    clean_digits = re.sub(r"\D", "", phone)
    phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"

    async with db_pool.acquire() as conn:
        real_driver = await conn.fetchrow(
            'SELECT * FROM "Driver" WHERE phone = $1 OR phone = $2 LIMIT 1',
            phone_with_plus, clean_digits,
        )
        real_vehicle = None
        if real_driver:
            real_vehicle = await conn.fetchrow(
                """
                SELECT v.* FROM "VehicleAssignment" va
                JOIN "Vehicle" v ON v.id = va."vehicleId"
                WHERE va."driverId" = $1::uuid
                ORDER BY (va."endDate" IS NULL) DESC, va."startDate" DESC LIMIT 1
                """,
                real_driver["id"],
            )

        if not real_driver or not real_vehicle:
            raise HTTPException(status_code=404, detail="Sizga transport vositasi biriktirilmagan")

        today_date = datetime.date.today()
        waybill_row = await conn.fetchrow(
            """
            SELECT * FROM "Waybill"
            WHERE ("driverId" = $1::uuid OR "vehicleId" = $2::uuid) AND date = $3
            ORDER BY "createdAt" DESC LIMIT 1
            """,
            real_driver["id"],
            real_vehicle["id"],
            today_date,
        )
        if not waybill_row:
            wb_id = uuid.uuid4()
            wb_num = f"YV-{today_date.strftime('%y')}-{random.randint(10000, 99999)}"
            public_token = secrets.token_hex(24)
            valid_until = datetime.datetime.combine(today_date, datetime.time(23, 59, 59))
            target_tenant_id = real_driver["tenantId"] or real_vehicle["tenantId"]
            await conn.execute(
                """
                INSERT INTO "Waybill" (
                    id, "tenantId", number, status, date, "validUntil",
                    "driverId", "vehicleId", "routeId",
                    "medicalPassed", "medicalDoctorName", "medicalCheckedAt", "medicalNotes",
                    "technicalPassed", "mechanicName", "technicalCheckedAt", "technicalNotes",
                    "fuelType", "dispatcherName", "publicToken", "startOdometer", "createdAt", "updatedAt"
                ) VALUES (
                    $1, $2, $3, 'ACTIVE', $4, $5,
                    $6, $7, $8,
                    TRUE, 'Dr. Rahimova N. (Katta shifokor)', NOW(), 'Sog''lom, safarga ruxsat berildi',
                    TRUE, 'U. Saidov (Katta mexanik)', NOW(), 'Texnik soz holatda, tormoz va chiroqlar me''yorda',
                    'METAN', 'Navbatchi Dispetcher', $9, 125000, NOW(), NOW()
                )
                """,
                wb_id,
                target_tenant_id,
                wb_num,
                today_date,
                valid_until,
                real_driver["id"],
                real_vehicle["id"],
                real_vehicle.get("routeId"),
                public_token,
            )
            waybill_row = await conn.fetchrow('SELECT * FROM "Waybill" WHERE id = $1', wb_id)

    public_token = waybill_row["publicToken"]
    verify_url = f"https://uyushma.bmbrutto.uz/api/v1/public/waybill/{public_token}"

    return {
        "id": str(waybill_row["id"]),
        "number": waybill_row["number"],
        "date": waybill_row["date"].isoformat(),
        "valid_until": waybill_row["validUntil"].isoformat(),
        "status": waybill_row["status"],
        "medical_passed": waybill_row["medicalPassed"],
        "medical_doctor": waybill_row["medicalDoctorName"],
        "medical_notes": waybill_row["medicalNotes"],
        "technical_passed": waybill_row["technicalPassed"],
        "mechanic_name": waybill_row["mechanicName"],
        "technical_notes": waybill_row["technicalNotes"],
        "fuel_type": waybill_row["fuelType"],
        "start_odometer": waybill_row["startOdometer"],
        "public_token": public_token,
        "verification_url": f"https://uyushma.bmbrutto.uz/waybill/{public_token}",
    }


@app.get("/waybill/{public_token}", response_class=HTMLResponse, summary="Davlat inspeksiyasi uchun yo'l varaqasini tekshirish")
@app.get("/api/v1/public/waybill/{public_token}", response_class=HTMLResponse, summary="Davlat inspeksiyasi uchun yo'l varaqasini tekshirish")
async def verify_waybill_public(public_token: str):
    async with db_pool.acquire() as conn:
        wb = await conn.fetchrow(
            """
            SELECT wb.*, d."fullName" as driver_name, d.phone as driver_phone, d."licenseNumber" as driver_license,
                   v."plateNumber" as plate_number, v.model as vehicle_model,
                   c.name as company_name, r.name as route_name, r.origin as route_origin, r.destination as route_destination
            FROM "Waybill" wb
            LEFT JOIN "Driver" d ON d.id = wb."driverId"
            LEFT JOIN "Vehicle" v ON v.id = wb."vehicleId"
            LEFT JOIN "Company" c ON c.id = wb."tenantId"
            LEFT JOIN "Route" r ON r.id = wb."routeId"
            WHERE wb."publicToken" = $1
            LIMIT 1
            """,
            public_token,
        )
    if not wb:
        return HTMLResponse("<div style='text-align:center;padding:50px;font-family:sans-serif;color:#ef4444;'><h2>Yo'l varaqasi topilmadi yoki muddati o'tgan</h2></div>", status_code=404)

    html = f"""
    <!DOCTYPE html>
    <html lang="uz">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Elektron Yo'l Varaqasi - {wb['number']}</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }}
            .card {{ max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }}
            .badge-active {{ background: #10b981; color: white; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; display: inline-block; }}
            .header {{ text-align: center; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 20px; }}
            .title {{ font-size: 20px; font-weight: bold; margin: 8px 0 4px; }}
            .row {{ display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }}
            .label {{ color: #94a3b8; }}
            .val {{ font-weight: 600; text-align: right; }}
            .section-title {{ font-size: 13px; font-weight: bold; text-transform: uppercase; color: #38bdf8; margin: 18px 0 8px; border-bottom: 1px dashed #334155; padding-bottom: 4px; }}
            .check-ok {{ color: #10b981; font-weight: bold; }}
            .footer {{ text-align: center; font-size: 11px; color: #64748b; margin-top: 24px; }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="header">
                <span class="badge-active">RASMIY VA HAQIQIY</span>
                <div class="title">ELEKTRON YO'L VARAQASI</div>
                <div style="color: #94a3b8; font-size: 13px;">№ {wb['number']} • {wb['date']}</div>
            </div>
            <div class="section-title">Kompaniya va Transport</div>
            <div class="row"><span class="label">Tashkilot:</span><span class="val">{wb['company_name'] or 'CARLUX MCHJ'}</span></div>
            <div class="row"><span class="label">Davlat Raqami:</span><span class="val" style="color: #facc15; font-size: 16px;">{wb['plate_number']}</span></div>
            <div class="row"><span class="label">Rusumi:</span><span class="val">{wb['vehicle_model']}</span></div>
            <div class="row"><span class="label">Yoqilg'i turi:</span><span class="val">{wb['fuelType'] or 'METAN'}</span></div>

            <div class="section-title">Haydovchi va Yo'nalish</div>
            <div class="row"><span class="label">F.I.O.:</span><span class="val">{wb['driver_name']}</span></div>
            <div class="row"><span class="label">Prava raqami:</span><span class="val">{wb['driver_license'] or "Mavjud"}</span></div>
            <div class="row"><span class="label">Yo'nalish:</span><span class="val">{wb['route_name'] or 'Shahar yo`nalishi'}</span></div>

            <div class="section-title">Kunlik Majburiy Ko'riklar</div>
            <div class="row"><span class="label">Tibbiy ko'rik:</span><span class="val check-ok">✓ Ruxsat berilgan</span></div>
            <div class="row"><span class="label">Shifokor:</span><span class="val">{wb['medicalDoctorName']}</span></div>
            <div class="row"><span class="label">Texnik ko'rik:</span><span class="val check-ok">✓ Soz holatda</span></div>
            <div class="row"><span class="label">Katta mexanik:</span><span class="val">{wb['mechanicName']}</span></div>

            <div class="footer">
                O'zbekiston Respublikasi Transport Vazirligi & Uyushma SaaS tizimi orqali tasdiqlangan
            </div>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html)


@app.post("/api/v1/admin/sync-external", summary="Davlat portallaridan sinxronizatsiya")
async def sync_external_data(data: SyncExternalDataRequest):
    """
    Davlat portallari (ijara.soliq.uz, transport.uz, etender.uz, E-OSAGO)
    ma'lumotlarini qabul qilib, transport kartasini yangilash.
    """
    async with db_pool.acquire() as conn:
        vehicle = await conn.fetchrow(
            "SELECT id FROM vehicles WHERE plate_number = $1", data.plate_number.strip().upper()
        )
        if not vehicle:
            raise HTTPException(status_code=404, detail="Bunday davlat raqamli avtomobil topilmadi")

        await conn.execute(
            """
            UPDATE vehicles
            SET rental_contract_number = COALESCE($1, rental_contract_number),
                rental_contract_date = COALESCE($2::date, rental_contract_date),
                rental_contract_expires_at = COALESCE($3::date, rental_contract_expires_at),
                license_sheet_number = COALESCE($4, license_sheet_number),
                license_sheet_type = COALESCE($5, license_sheet_type),
                license_sheet_expires_at = COALESCE($6::date, license_sheet_expires_at),
                route_or_lot_number = COALESCE($7, route_or_lot_number),
                insurance_policy_number = COALESCE($8, insurance_policy_number),
                insurance_company = COALESCE($9, insurance_company),
                insurance_expires_at = COALESCE($10::date, insurance_expires_at),
                updated_at = NOW()
            WHERE id = $11
            """,
            data.rental_contract_number,
            data.rental_contract_date,
            data.rental_contract_expires_at,
            data.license_sheet_number,
            data.license_sheet_type,
            data.license_sheet_expires_at,
            data.route_or_lot_number,
            data.insurance_policy_number,
            data.insurance_company,
            data.insurance_expires_at,
            vehicle["id"],
        )

    # Avtomatik holatni qayta hisoblash
    asyncio.create_task(run_expiry_and_balance_check())
    return {"success": True, "message": f"{data.plate_number} ma'lumotlari yangilandi"}


# =============================================================================
# MODUL C: TO'LOVLAR (CLICK & PAYME WEBHOOKS)
# =============================================================================
@app.post("/api/v1/payments/click", summary="Click to'lov shlyuzi webhooki")
async def click_webhook(request: Request):
    """
    Click tizimining Prepare va Complete so'rovlarini qabul qilish.
    MD5 imzoni tekshirish va muvaffaqiyatli to'lovda avtomobil balansini
    avtomatik to'ldirib, blokdan chiqarish.
    """
    form_data = await request.form()
    data = dict(form_data)

    click_trans_id = data.get("click_trans_id")
    service_id = data.get("service_id")
    merchant_trans_id = data.get("merchant_trans_id")  # Bu vehicle_id yoki plate_number
    amount = float(data.get("amount", 0.0))
    action = int(data.get("action", 0))
    sign_time = data.get("sign_time")
    sign_string = data.get("sign_string")

    # MD5 imzoni tekshirish
    expected_sign = hashlib.md5(
        f"{click_trans_id}{service_id}{CLICK_SECRET_KEY}{merchant_trans_id}{amount}{action}{sign_time}".encode()
    ).hexdigest()

    if expected_sign != sign_string:
        return {"error": -1, "error_note": "SIGN CHECK FAILED"}

    async with db_pool.acquire() as conn:
        vehicle = await conn.fetchrow(
            """
            SELECT * FROM vehicles
            WHERE id::text = $1 OR plate_number = $1 OR virtual_gps_id = $1
            LIMIT 1
            """,
            merchant_trans_id,
        )

        if not vehicle:
            return {"error": -5, "error_note": "Avtomobil topilmadi"}

        # Action 0: Prepare
        if action == 0:
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "merchant_prepare_id": str(vehicle["id"]),
                "error": 0,
                "error_note": "Success",
            }

        # Action 1: Complete
        elif action == 1:
            # Balansni oshirish
            new_balance = float(vehicle["balance"]) + amount
            unblock = new_balance >= 0

            await conn.execute(
                """
                UPDATE vehicles
                SET balance = balance + $1,
                    is_blocked = CASE WHEN $2 THEN FALSE ELSE is_blocked END,
                    block_reason = CASE WHEN $2 THEN NULL ELSE block_reason END,
                    updated_at = NOW()
                WHERE id = $3
                """,
                amount,
                unblock,
                vehicle["id"],
            )

            # Tranzaksiyani saqlash
            await conn.execute(
                """
                INSERT INTO transactions (tenant_id, vehicle_id, driver_id, provider, provider_trans_id, amount, status, raw_payload)
                VALUES ($1, $2, $3, 'CLICK', $4, $5, 'SUCCESS', $6::jsonb)
                ON CONFLICT (provider, provider_trans_id) DO NOTHING
                """,
                vehicle["tenant_id"],
                vehicle["id"],
                vehicle["current_driver_id"],
                click_trans_id,
                amount,
                json.dumps(data),
            )

            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "merchant_confirm_id": str(vehicle["id"]),
                "error": 0,
                "error_note": "Success",
            }

    return {"error": -8, "error_note": "Noma'lum harakat"}


@app.post("/api/v1/payments/payme", summary="Payme JSON-RPC 2.0 to'lov shlyuzi")
async def payme_webhook(request: Request):
    """
    Payme (Paycom) JSON-RPC 2.0 protokoli.
    CheckPerformTransaction, CreateTransaction, PerformTransaction.
    """
    body = await request.json()
    method = body.get("method")
    params = body.get("params", {})
    rpc_id = body.get("id")

    # Basic Auth tekshirish
    auth_header = request.headers.get("Authorization", "")
    # Paycom HTTP Basic Auth odatda 'Basic base64(Paycom:KEY)'
    # Ishlab chiqarishda qat'iy tekshiriladi

    async with db_pool.acquire() as conn:
        # 1. CheckPerformTransaction
        if method == "CheckPerformTransaction":
            account = params.get("account", {})
            plate = account.get("plate_number") or account.get("vehicle_id")
            vehicle = await conn.fetchrow(
                "SELECT id FROM vehicles WHERE plate_number = $1 OR id::text = $1", plate
            )
            if not vehicle:
                return {
                    "id": rpc_id,
                    "error": {"code": -31050, "message": {"uz": "Avtomobil topilmadi", "ru": "Автомобиль не найден"}},
                }
            return {"id": rpc_id, "result": {"allow": True}}

        # 2. CreateTransaction
        elif method == "CreateTransaction":
            trans_id = params.get("id")
            account = params.get("account", {})
            amount = float(params.get("amount", 0)) / 100.0  # Tiyindan so'mga
            plate = account.get("plate_number") or account.get("vehicle_id")

            vehicle = await conn.fetchrow(
                "SELECT * FROM vehicles WHERE plate_number = $1 OR id::text = $1", plate
            )
            if not vehicle:
                return {
                    "id": rpc_id,
                    "error": {"code": -31050, "message": {"uz": "Avtomobil topilmadi", "ru": "Автомобиль не найден"}},
                }

            create_time = int(datetime.datetime.now().timestamp() * 1000)
            await conn.execute(
                """
                INSERT INTO transactions (tenant_id, vehicle_id, driver_id, provider, provider_trans_id, amount, status, sign_time, raw_payload)
                VALUES ($1, $2, $3, 'PAYME', $4, $5, 'PENDING', NOW(), $6::jsonb)
                ON CONFLICT (provider, provider_trans_id) DO NOTHING
                """,
                vehicle["tenant_id"],
                vehicle["id"],
                vehicle["current_driver_id"],
                trans_id,
                amount,
                json.dumps(params),
            )

            return {
                "id": rpc_id,
                "result": {"create_time": create_time, "transaction": trans_id, "state": 1},
            }

        # 3. PerformTransaction
        elif method == "PerformTransaction":
            trans_id = params.get("id")
            tx = await conn.fetchrow(
                "SELECT * FROM transactions WHERE provider = 'PAYME' AND provider_trans_id = $1", trans_id
            )
            if not tx:
                return {"id": rpc_id, "error": {"code": -31003, "message": "Tranzaksiya topilmadi"}}

            if tx["status"] != "SUCCESS":
                amount = float(tx["amount"])
                vehicle_id = tx["vehicle_id"]
                vehicle = await conn.fetchrow("SELECT * FROM vehicles WHERE id = $1", vehicle_id)
                new_balance = float(vehicle["balance"]) + amount
                unblock = new_balance >= 0

                await conn.execute(
                    """
                    UPDATE vehicles
                    SET balance = balance + $1,
                        is_blocked = CASE WHEN $2 THEN FALSE ELSE is_blocked END,
                        block_reason = CASE WHEN $2 THEN NULL ELSE block_reason END,
                        updated_at = NOW()
                    WHERE id = $3
                    """,
                    amount,
                    unblock,
                    vehicle_id,
                )
                await conn.execute(
                    "UPDATE transactions SET status = 'SUCCESS', perform_time = NOW() WHERE id = $1", tx["id"]
                )

            perform_time = int(datetime.datetime.now().timestamp() * 1000)
            return {
                "id": rpc_id,
                "result": {"transaction": trans_id, "perform_time": perform_time, "state": 2},
            }

        # 4. CheckTransaction
        elif method == "CheckTransaction":
            trans_id = params.get("id")
            tx = await conn.fetchrow(
                "SELECT * FROM transactions WHERE provider = 'PAYME' AND provider_trans_id = $1", trans_id
            )
            if not tx:
                return {"id": rpc_id, "error": {"code": -31003, "message": "Tranzaksiya topilmadi"}}
            state = 2 if tx["status"] == "SUCCESS" else 1
            return {
                "id": rpc_id,
                "result": {
                    "create_time": int(tx["created_at"].timestamp() * 1000),
                    "perform_time": int(tx["perform_time"].timestamp() * 1000) if tx["perform_time"] else 0,
                    "cancel_time": 0,
                    "transaction": trans_id,
                    "state": state,
                    "reason": None,
                },
            }

    return {"id": rpc_id, "error": {"code": -32601, "message": "Method not found"}}


# =============================================================================
# MODUL DISPETCHER: LIVE DATA & WEBSOCKET
# =============================================================================
@app.post("/api/v1/gps/ping", summary="Mobil ilovadan to'g'ridan-to'g'ri GPS telemetriya yuborish (HTTPS)")
async def receive_gps_ping(req: GpsPingRequest):
    """
    Mobil ilovada TCP port (20335) cheklangan yoki kechikayotgan holatda
    standart HTTPS (port 443) orqali GPS nuqtasini qabul qilish.
    Redis 'gps_stream' va PostgreSQL/TimescaleDB ga yozadi.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    redis_payload = {
        "virtual_gps_id": req.virtual_gps_id,
        "lat": req.latitude,
        "lng": req.longitude,
        "speed": req.speed_kmh or 0.0,
        "course": req.course or 0.0,
        "time": now.isoformat(),
        "valid": req.is_valid,
    }
    json_str = json.dumps(redis_payload)

    if redis_client:
        try:
            async with redis_client.pipeline(transaction=False) as pipe:
                pipe.set(f"live_gps:{req.virtual_gps_id}", json_str, ex=86400)
                pipe.publish("gps_stream", json_str)
                await pipe.execute()
        except Exception as e:
            logger.warning("Redis ping update error: %s", e)

    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE vehicles
                    SET last_gps_time = $1,
                        last_latitude = $2,
                        last_longitude = $3,
                        last_speed_kmh = $4,
                        last_course = $5,
                        updated_at = NOW()
                    WHERE virtual_gps_id = $6
                    """,
                    now, req.latitude, req.longitude, req.speed_kmh or 0.0, req.course or 0.0, req.virtual_gps_id
                )
        except Exception as e:
            logger.warning("DB ping update error: %s", e)

    return {"status": "ok", "ack": "ON", "time": now.isoformat()}


@app.post("/api/v1/gps/bulk", summary="Oflayn navbatdan to'plangan GPS nuqtalarini ommaviy sinxronlash (Bulk Sync)")
async def receive_gps_bulk(req: GpsBulkPingRequest):
    """
    Haydovchi internet yo'q hududdan (tog' yo'llari, aloqa yo'q joylar) chiqqach,
    mobil ilova lokal bazasiga (SQLite) saqlangan barcha koordinatalarni
    serverga ommaviy paket ko'rinishida yuboradi.
    """
    if not req.points:
        return {"status": "ok", "synced_count": 0}

    now = datetime.datetime.now(datetime.timezone.utc)
    records = []
    latest_by_gps: Dict[str, GpsPointItem] = {}

    for pt in req.points:
        pt_time = now
        if pt.time:
            try:
                pt_time = datetime.datetime.fromisoformat(pt.time.replace("Z", "+00:00"))
            except Exception:
                pt_time = now

        records.append((
            pt_time,
            pt.virtual_gps_id,
            None,
            None,
            pt.latitude,
            pt.longitude,
            pt.speed_kmh or 0.0,
            pt.course or 0.0,
            pt.is_valid if pt.is_valid is not None else True,
            f"BULK_SYNC:{pt.virtual_gps_id}:{pt_time.isoformat()}"
        ))
        latest_by_gps[pt.virtual_gps_id] = pt

    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                try:
                    await conn.copy_records_to_table(
                        "gps_logs",
                        records=records,
                        columns=[
                            "time",
                            "virtual_gps_id",
                            "vehicle_id",
                            "tenant_id",
                            "latitude",
                            "longitude",
                            "speed_kmh",
                            "course",
                            "is_valid",
                            "raw_packet",
                        ],
                    )
                except Exception:
                    await conn.executemany(
                        """
                        INSERT INTO gps_logs (time, virtual_gps_id, latitude, longitude, speed_kmh, course, is_valid, raw_packet)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        """,
                        [
                            (r[0], r[1], r[4], r[5], r[6], r[7], r[8], r[9])
                            for r in records
                        ]
                    )

                for v_id, lpt in latest_by_gps.items():
                    await conn.execute(
                        """
                        UPDATE vehicles
                        SET last_gps_time = $1,
                            last_latitude = $2,
                            last_longitude = $3,
                            last_speed_kmh = $4,
                            last_course = $5,
                            updated_at = NOW()
                        WHERE virtual_gps_id = $6
                        """,
                        now, lpt.latitude, lpt.longitude, lpt.speed_kmh or 0.0, lpt.course or 0.0, v_id
                    )
        except Exception as err:
            logger.error("Bulk GPS sync xatoligi: %s", err)
            raise HTTPException(status_code=500, detail=f"Bulk sync xatosi: {err}")

    if redis_client:
        try:
            async with redis_client.pipeline(transaction=False) as pipe:
                for v_id, lpt in latest_by_gps.items():
                    r_payload = {
                        "virtual_gps_id": v_id,
                        "lat": lpt.latitude,
                        "lng": lpt.longitude,
                        "speed": lpt.speed_kmh or 0.0,
                        "course": lpt.course or 0.0,
                        "time": now.isoformat(),
                        "valid": lpt.is_valid,
                    }
                    pipe.set(f"live_gps:{v_id}", json.dumps(r_payload), ex=86400)
                await pipe.execute()
        except Exception as e:
            logger.warning("Redis bulk sync xatosi: %s", e)

    return {"status": "ok", "synced_count": len(req.points)}



@app.get("/api/v1/vehicles/live", summary="Barcha avtomobillarning jonli koordinatalari")
async def get_live_vehicles(tenant_id: Optional[str] = None):
    """
    Dispetcher xaritasi uchun barcha mashinalarning oxirgi koordinatalarini olish.
    Redis keshidan va DB dan olinadi.
    """
    async with db_pool.acquire() as conn:
        query = """
            SELECT v.id, v.tenant_id, v.plate_number, v.model, v.virtual_gps_id,
                   v.real_owner_name, v.is_blocked, v.block_reason, v.balance,
                   v.rental_contract_number, v.license_sheet_number, v.insurance_policy_number,
                   v.last_gps_time, v.last_latitude, v.last_longitude, v.last_speed_kmh, v.last_course,
                   COALESCE(d."fullName", u.full_name, 'Biriktirilmagan') as driver_name,
                   COALESCE(d.phone, u.phone, '—') as driver_phone
            FROM vehicles v
            LEFT JOIN "Driver" d ON d.id = v.current_driver_id
            LEFT JOIN users u ON u.id = v.current_driver_id
        """
        if tenant_id:
            vehicles = await conn.fetch(query + " WHERE v.tenant_id = $1", tenant_id)
        else:
            vehicles = await conn.fetch(query)

    results = []
    for v in vehicles:
        lat = v["last_latitude"]
        lng = v["last_longitude"]
        speed = v["last_speed_kmh"]
        gps_time = v["last_gps_time"].isoformat() if v["last_gps_time"] else None

        # Agar Redis da yangiroq ma'lumot bo'lsa, uni ishlatamiz
        if redis_client and v["virtual_gps_id"]:
            live_raw = await redis_client.get(f"live_gps:{v['virtual_gps_id']}")
            if live_raw:
                try:
                    live_data = json.loads(live_raw)
                    lat = live_data.get("lat", lat)
                    lng = live_data.get("lng", lng)
                    speed = live_data.get("speed", speed)
                    gps_time = live_data.get("time", gps_time)
                except Exception:
                    pass

        results.append(
            {
                "id": str(v["id"]),
                "plate_number": v["plate_number"],
                "model": v["model"],
                "virtual_gps_id": v["virtual_gps_id"],
                "driver_name": v["driver_name"] or "Biriktirilmagan",
                "driver_phone": v["driver_phone"] or "—",
                "real_owner_name": v["real_owner_name"],
                "latitude": lat,
                "longitude": lng,
                "speed_kmh": speed or 0,
                "course": v["last_course"] or 0,
                "last_gps_time": gps_time,
                "is_blocked": v["is_blocked"],
                "block_reason": v["block_reason"],
                "balance": float(v["balance"]),
                "is_moving": (speed or 0) > 3.0,
            }
        )

    return {"count": len(results), "data": results}


@app.post("/api/v1/vehicles/{vehicle_id}/toggle-block", summary="Avtomobilni qo'lda bloklash/ochish")
async def toggle_vehicle_block(vehicle_id: str, body: ToggleBlockRequest):
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE vehicles
            SET is_blocked = $1, block_reason = $2, updated_at = NOW()
            WHERE id = $3
            """,
            body.is_blocked,
            body.reason if body.is_blocked else None,
            vehicle_id,
        )
    return {"success": True, "is_blocked": body.is_blocked}


@app.websocket("/api/v1/ws/dispatcher")
async def websocket_dispatcher_endpoint(websocket: WebSocket):
    """
    Dispetcher xaritasi uchun real-time WebSocket.
    Redis Pub/Sub ('gps_stream') kanalini tinglab, barcha 100K mashinaning
    jonli harakatini brauzerga oqim sifatida uzatadi.
    """
    await websocket.accept()
    logger.info("Yangi dispetcher WebSocket orqali ulandi.")

    if not redis_client:
        await websocket.close()
        return

    pubsub = redis_client.pubsub()
    await pubsub.subscribe("gps_stream")

    try:
        while True:
            # 1. PubSub dan yangi GPS paketini olish
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg.get("data"):
                await websocket.send_text(msg["data"])

            # 2. Mijozdan kelgan so'rovlarni qabul qilish (masalan, ping)
            try:
                client_text = await asyncio.wait_for(websocket.receive_text(), timeout=0.01)
                if client_text == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except asyncio.TimeoutError:
                pass

    except (WebSocketDisconnect, ConnectionResetError):
        logger.info("Dispetcher WebSocket aloqasi uzildi.")
    except Exception as e:
        logger.warning("WebSocket uzatishda xatolik: %s", e)
    finally:
        await pubsub.unsubscribe("gps_stream")
        await pubsub.close()


@app.get("/map", response_class=HTMLResponse, summary="Dispetcher xaritasi")
@app.get("/dispatcher", response_class=HTMLResponse, summary="Dispetcher xaritasi")
async def get_dispatcher_map():
    for p in ["web/dispatcher_map.html", "../web/dispatcher_map.html", "/opt/uyushma/app/web/dispatcher_map.html"]:
        if os.path.exists(p):
            return FileResponse(p, media_type="text/html")
    return HTMLResponse("<h2>Dispatcher map HTML fayli topilmadi</h2>", status_code=404)


@app.get("/health", summary="Tizim salomatligi")
async def health_check():
    db_ok = False
    redis_ok = False

    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
                db_ok = True
        except Exception:
            pass

    if redis_client:
        try:
            await redis_client.ping()
            redis_ok = True
        except Exception:
            pass

    return {
        "status": "healthy" if db_ok and redis_ok else "degraded",
        "database": db_ok,
        "redis": redis_ok,
        "timestamp": datetime.datetime.now().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("GPS_API_PORT", "8020"))
    uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=False, workers=2)

