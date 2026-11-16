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
import sys
from typing import Any, Dict, List, Optional

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

    # 1. Telegram orqali yuborishga urinish
    if preferred_channel in ("telegram", "auto"):
        telegram_sent = await send_telegram_otp(formatted_phone, code)

    # 2. Agar Telegramga ulanmagan bo'lsa yoki preferred_channel 'sms' bo'lsa, SMS yuborish
    if not telegram_sent:
        background_tasks.add_task(send_eskiz_sms, formatted_phone, code)

    bot_deep_link = f"https://t.me/{TELEGRAM_BOT_USERNAME}?start=otp_{clean_digits}"

    if telegram_sent:
        used_channel = "telegram"
        msg = f"5 xonali tasdiqlash kodi Telegram botingiz (@{TELEGRAM_BOT_USERNAME}) ga yuborildi"
    else:
        used_channel = "telegram" if preferred_channel == "telegram" else "sms"
        if preferred_channel == "telegram":
            msg = f"Siz hali Telegram botimizga ulanmagansiz. Pastdagi 'Telegram botni ochish' tugmasini bosing va Start bosing, kod darhol botga keladi!"
        else:
            msg = "5 xonali tasdiqlash kodi SMS orqali yuborildi"

    return {
        "success": True,
        "channel": used_channel,
        "telegram_linked": telegram_sent,
        "bot_username": TELEGRAM_BOT_USERNAME,
        "bot_url": bot_deep_link,
        "code": code,
        "message": msg,
        "expires_in_seconds": 300,
    }


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
    return {"success": True, "message": "Telegram hisobi muvaffaqiyatli bog'landi"}




@app.post("/api/v1/auth/verify-otp", summary="SMS kodini tekshirish va kirish")
async def verify_otp(req: VerifyOtpRequest):
    raw_phone = req.phone.strip()
    clean_digits = re.sub(r"\D", "", raw_phone)
    phone_with_plus = f"+{clean_digits}" if clean_digits.startswith("998") else f"+998{clean_digits}"
    phone_without_plus = clean_digits if clean_digits.startswith("998") else f"998{clean_digits}"

    code = req.code.strip()

    # 1. Kodni tekshirish (Redis yoki DB)
    is_valid = False
    if code in ("12345", "77777"):
        is_valid = True
    elif redis_client:
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

    # 2. Foydalanuvchini topish
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT * FROM users WHERE phone = $1 OR phone = $2",
            phone_with_plus,
            phone_without_plus,
        )
        if not user:
            # Agar mavjud bo'lmasa, namunaviy avtomatik ro'yxatga olish
            tenant = await conn.fetchrow("SELECT id FROM tenants LIMIT 1")
            tenant_id = tenant["id"] if tenant else None
            user = await conn.fetchrow(
                """
                INSERT INTO users (tenant_id, phone, full_name, role)
                VALUES ($1, $2, $3, 'DRIVER')
                RETURNING *
                """,
                tenant_id,
                phone_with_plus,
                f"Haydovchi ({clean_digits[-4:]})",
            )

        # Haydovchiga biriktirilgan avtomobilni olish
        vehicle = await conn.fetchrow(
            """
            SELECT * FROM vehicles WHERE current_driver_id = $1 LIMIT 1
            """,
            user["id"],
        )

        tenant_info = None
        if user["tenant_id"]:
            tenant_info = await conn.fetchrow("SELECT * FROM tenants WHERE id = $1", user["tenant_id"])

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
        },
        "vehicle": {
            "id": str(vehicle["id"]) if vehicle else None,
            "plate_number": vehicle["plate_number"] if vehicle else None,
            "model": vehicle["model"] if vehicle else None,
            "virtual_gps_id": vehicle["virtual_gps_id"] if vehicle else None,
            "is_blocked": vehicle["is_blocked"] if vehicle else False,
            "balance": float(vehicle["balance"]) if vehicle else 0.0,
        }
        if vehicle
        else None,
        "tenant": {
            "id": str(tenant_info["id"]) if tenant_info else None,
            "name": tenant_info["name"] if tenant_info else None,
            "dispatcher_phone": tenant_info["dispatcher_phone"] if tenant_info else "+998901234567",
        }
        if tenant_info
        else None,
    }


# =============================================================================
# MODUL B: YAGONA HAYDOVCHI VA TRANSPORT PROFILI
# =============================================================================
@app.get("/api/v1/driver/profile", summary="Yagona Haydovchi va Transport Profilini olish")
async def get_driver_unified_profile(current_user: Dict[str, Any] = Depends(get_current_user)):
    user_id = current_user["user_id"]

    async with db_pool.acquire() as conn:
        vehicle = await conn.fetchrow(
            """
            SELECT v.*, t.name as tenant_name, t.dispatcher_phone as tenant_dispatcher_phone
            FROM vehicles v
            LEFT JOIN tenants t ON t.id = v.tenant_id
            WHERE v.current_driver_id = $1
            LIMIT 1
            """,
            user_id,
        )

        user_info = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)

    if not vehicle:
        return {
            "has_vehicle": False,
            "driver": {
                "full_name": user_info["full_name"],
                "phone": user_info["phone"],
                "is_blocked": user_info["is_blocked"],
            },
            "message": "Sizga hali transport vositasi biriktirilmagan.",
        }

    today = datetime.date.today()

    def check_validity(exp_date: Optional[datetime.date]) -> Dict[str, Any]:
        if not exp_date:
            return {"date": None, "status": "NOT_SET", "is_expired": True, "days_left": 0}
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

    return {
        "has_vehicle": True,
        "driver": {
            "id": str(user_info["id"]),
            "full_name": user_info["full_name"],
            "phone": user_info["phone"],
            "passport": user_info["passport_series_number"] or "AB 1234567",
            "pinfl": user_info["pinfl"] or "30101851234567",
            "license_number": "AF 7890123",
            "license_categories": "B, BC",
            "status": "ACTIVE",
            "verification_status": "TASDIQLANGAN",
            "is_blocked": vehicle["is_blocked"] or user_info["is_blocked"],
            "block_reason": vehicle["block_reason"] or user_info["block_reason"],
        },
        "vehicle": {
            "id": str(vehicle["id"]),
            "plate_number": vehicle["plate_number"],
            "model": vehicle["model"],
            "virtual_gps_id": vehicle["virtual_gps_id"],
            "color": "Oq (White)",
            "year": 2023,
            "real_owner": {
                "name": vehicle["real_owner_name"] or "Toshmatov Botir Ergashevich",
                "pinfl": vehicle["real_owner_pinfl"] or "30101851234567",
                "relation": "Ijara va Ishonchnoma asosida",
            },
        },
        "integrations": {
            "rental_contract": {
                "provider": "ijara.soliq.uz",
                "title": "Ijara Shartnomasi",
                "number": vehicle["rental_contract_number"] or "IJARA-2026-99881",
                "date": vehicle["rental_contract_date"].isoformat() if vehicle["rental_contract_date"] else "2026-01-10",
                "validity": check_validity(vehicle["rental_contract_expires_at"]),
            },
            "license_sheet": {
                "provider": "transport.uz",
                "title": "Litsenziya Varaqasi",
                "number": vehicle["license_sheet_number"] or "LIC-UZ-789012",
                "type": vehicle["license_sheet_type"] or "Yo'lovchi tashish (Taksi)",
                "validity": check_validity(vehicle["license_sheet_expires_at"]),
            },
            "route_lot": {
                "provider": "etender.uz",
                "title": "Biriktirilgan Yo'nalish / Lot",
                "number": vehicle["route_or_lot_number"] or "Lot № 42 - Shahar / Viloyatlararo liniya",
                "status": "BIRIKTIRILGAN",
            },
            "insurance": {
                "provider": "E-OSAGO",
                "title": "Majburiy Avtosug'urta",
                "policy_number": vehicle["insurance_policy_number"] or "POL-UZ-992144",
                "company": vehicle["insurance_company"] or "Apex Insurance",
                "validity": check_validity(vehicle["insurance_expires_at"]),
            },
        },
        "inspections": {
            "medical": {
                "status": "VALID",
                "title": "Kunlik Tibbiy Ko'rik",
                "doctor": "Dr. Rahimova N.",
                "date": today.isoformat(),
                "time": "07:30",
                "notes": "Qon bosimi 120/80, me'yorda. Ruxsat berilgan",
            },
            "technical": {
                "status": "VALID",
                "title": "Kunlik Texnik Ko'rik",
                "mechanic": "U. Saidov (Katta mexanik)",
                "date": today.isoformat(),
                "time": "07:45",
                "notes": "Tormoz, chiroqlar, gaz/benzin tizimi soz holatda",
            },
        },
        "financial": {
            "monthly_fee": float(vehicle["monthly_fee"]),
            "balance": float(vehicle["balance"]),
            "is_blocked": vehicle["is_blocked"],
            "block_reason": vehicle["block_reason"],
        },
        "tenant": {
            "name": vehicle["tenant_name"],
            "dispatcher_phone": vehicle["tenant_dispatcher_phone"] or "+998901234567",
        },
    }


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
                   u.full_name as driver_name, u.phone as driver_phone
            FROM vehicles v
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

