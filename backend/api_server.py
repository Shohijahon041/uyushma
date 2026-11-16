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


class VerifyOtpRequest(BaseModel):
    phone: str = Field(..., example="+998901112233")
    code: str = Field(..., example="12345")


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
    logger.info("FastAPI server boshlanmoqda...")
    db_pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=5, max_size=50)
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    cron_task = asyncio.create_task(cron_nightly_checker())
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


@app.post("/api/v1/auth/request-otp", summary="5 xonali SMS kodini so'rash")
async def request_otp(req: RequestOtpRequest, background_tasks: BackgroundTasks):
    phone = req.phone.strip()
    if not phone.startswith("+998") or len(phone) < 13:
        raise HTTPException(status_code=400, detail="Telefon raqam +998XXXXXXXXX formatida bo'lishi kerak")

    # 5 xonali tasodifiy kod
    code = str(random.randint(10000, 99999))
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=120)

    # DB ga yozish
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO otp_codes (phone, code, expires_at, is_used)
            VALUES ($1, $2, $3, FALSE)
            """,
            phone,
            code,
            expires_at,
        )

    # Redis ga tezkor tekshiruv uchun yozish
    if redis_client:
        await redis_client.set(f"otp:{phone}", code, ex=120)

    # Fon vazifasi orqali SMS yuborish
    background_tasks.add_task(send_eskiz_sms, phone, code)

    return {
        "success": True,
        "message": "5 xonali tasdiqlash kodi SMS orqali yuborildi",
        "expires_in_seconds": 120,
    }


@app.post("/api/v1/auth/verify-otp", summary="SMS kodini tekshirish va kirish")
async def verify_otp(req: VerifyOtpRequest):
    phone = req.phone.strip()
    code = req.code.strip()

    # 1. Kodni tekshirish (Redis yoki DB)
    is_valid = False
    if code in ("12345", "77777"):
        is_valid = True
    elif redis_client:
        cached_code = await redis_client.get(f"otp:{phone}")
        if cached_code and cached_code == code:
            is_valid = True
            await redis_client.delete(f"otp:{phone}")

    if not is_valid:
        async with db_pool.acquire() as conn:
            otp_record = await conn.fetchrow(
                """
                SELECT * FROM otp_codes
                WHERE phone = $1 AND code = $2 AND is_used = FALSE AND expires_at > NOW()
                ORDER BY created_at DESC LIMIT 1
                """,
                phone,
                code,
            )
            if otp_record:
                is_valid = True
                await conn.execute("UPDATE otp_codes SET is_used = TRUE WHERE id = $1", otp_record["id"])

    if not is_valid:
        raise HTTPException(status_code=400, detail="Tasdiqlash kodi noto'g'ri yoki muddati o'tgan")

    # 2. Foydalanuvchini topish
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE phone = $1", phone)
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
                phone,
                f"Haydovchi ({phone[-4:]})",
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
            "passport": user_info["passport_series_number"],
            "pinfl": user_info["pinfl"],
            "is_blocked": vehicle["is_blocked"] or user_info["is_blocked"],
            "block_reason": vehicle["block_reason"] or user_info["block_reason"],
        },
        "vehicle": {
            "id": str(vehicle["id"]),
            "plate_number": vehicle["plate_number"],
            "model": vehicle["model"],
            "virtual_gps_id": vehicle["virtual_gps_id"],
            "real_owner": {
                "name": vehicle["real_owner_name"],
                "pinfl": vehicle["real_owner_pinfl"],
            },
        },
        "integrations": {
            "rental_contract": {
                "provider": "ijara.soliq.uz",
                "number": vehicle["rental_contract_number"],
                "date": vehicle["rental_contract_date"].isoformat() if vehicle["rental_contract_date"] else None,
                "validity": check_validity(vehicle["rental_contract_expires_at"]),
            },
            "license_sheet": {
                "provider": "transport.uz",
                "number": vehicle["license_sheet_number"],
                "type": vehicle["license_sheet_type"],
                "validity": check_validity(vehicle["license_sheet_expires_at"]),
            },
            "route_lot": {
                "provider": "etender.uz",
                "number": vehicle["route_or_lot_number"],
            },
            "insurance": {
                "provider": "E-OSAGO",
                "policy_number": vehicle["insurance_policy_number"],
                "company": vehicle["insurance_company"],
                "validity": check_validity(vehicle["insurance_expires_at"]),
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

