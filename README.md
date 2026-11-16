# 🚖 UYUSHMA GPS & FLEET SAAS (PRODUCTION READY)

O‘zbekiston Respublikasi transport uyushmalari, taksoparklar va yo‘lovchi tashish korxonalari uchun mo‘ljallangan, **100 000+ faol transport vositasi va haydovchini** bir vaqtning o‘zida real vaqt rejimida boshqaruvchi yuqori yuklamali (High-Load) GPS monitoring va korporativ SaaS platformasi.

---

## 🏛️ Tizim Arxitekturasi (100K High-Load Architecture)

Platforma mikroxizmatlar va asinxron arxitekturaga asoslangan bo‘lib, millionlab telemetriya paketlarini yo‘qotmasdan qabul qilish va qayta ishlashga qodir:

```
                          [ 100 000+ SinoTrack ST-901M / Flutter Mobile Apps ]
                                                 │
                                 ┌───────────────┴───────────────┐
                                 ▼ (TCP Port 20335)              ▼ (HTTPS 443 /api/v1/gps/ping & bulk)
                       [ Nginx Stream Proxy ]            [ Nginx Web / API ]
                                 │                               │
                 ┌───────────────┴───────────────┐               │
                 ▼                               ▼               ▼
      [ H02 Gateway Worker 1 ]       [ H02 Gateway Worker 2 ]  [ FastAPI API Server ]
                 │                               │               │
                 ├───────────────────────────────┴───────────────┤
                 │                                               │
                 ▼ (Real-time Pub/Sub & Last Point Cache)         ▼ (Security & AES-256)
        [ Redis 7 Cluster ]                             [ PGBouncer Pooler (Port 6432) ]
                 │ (gps_stream)                                  │ (Transaction Pooling)
                 ▼                                               ▼
      [ Live WebSocket Map ]                        [ PostgreSQL 16 + TimescaleDB ]
     (https://uyushma.bmbrutto.uz)                        (gps_logs hypertable)
                 │
                 ▼ (Upstream Forwarding)
    [ Davlat Portali: bm.dtransport.uz:20335 ]
```

### Arxitektura komponentlari:
1. **H02 TCP Gateway (Python 3.12 + AsyncIO):** SinoTrack ST-901M va mobil ilovadan H02 protokoli baytlarini qabul qiladi, NMEA koordinatalarini hisoblaydi va davlat serveriga (`bm.dtransport.uz`) yo‘naltiradi.
2. **PostgreSQL 16 + TimescaleDB (gps_logs hypertable):** Sekundiga 10 000+ GPS nuqtalarini mikro-batching (`asyncio.Queue`) orqali bazaga ommaviy yozadi.
3. **PGBouncer (Transaction Pooling):** 100 000 ta parallel haydovchi ulanishini 50–100 ta real ma'lumotlar bazasi ulanishiga siqib, `too many connections` xatosining oldini oladi.
4. **Redis 7 (In-Memory Pub/Sub & Key-Value):** Barcha avtomobillarning eng so‘nggi koordinatasini saqlaydi va Dispetcher veb-xaritasiga WebSocket orqali jonli uzatadi.
5. **AES-256-GCM Shifrlash Moduli:** Davlat portallari (`ijara.soliq.uz`, `transport.uz`, `etender.uz`, `E-OSAGO`) login, parol va sertifikatlarini ma'lumotlar bazasida shifrlangan holatda saqlaydi.
6. **Flutter Mobil Ilovasi (Android/iOS):** Fondagi joylashuv kuzatuvi (Foreground Service), Batareya optimizatsiyasidan chiqarish (Whitelist), Oflayn GPS navbati (SQLite) va tarmoq tiklanganda ommaviy sinxronlash (Bulk Sync).

---

## ⚡ Bir Buyruq Bilan Ishga Tushirish (Docker Compose)

### 1. Talablar:
- Docker Engine >= 24.0 va Docker Compose v2
- Linux (Ubuntu 22.04/24.04 LTS tavsiya etiladi) yoki Windows (WSL2)
- RAM: Kamida 4GB (100K yuklama uchun 16GB+ tavsiya etiladi)

### 2. O‘rnatish va Konfiguratsiya:

```bash
# 1. Repozitoriyni klonlash
git clone https://github.com/Shohijahon041/uyushma.git
cd uyushma

# 2. Muhit parametrlarini sozlash
cp .env.example .env

# 3. Maxfiy shifrlash va JWT kalitlarini generatsiya qilish:
# Linux/macOS:
openssl rand -hex 32
# Chiqqan kalitni .env dagi ENCRYPTION_SECRET_KEY va JWT_SECRET ga qo'ying.
```

### 3. Ishga Tushirish:

```bash
# Barcha mikroxizmatlarni (TimescaleDB, PGBouncer, Redis, Gateways, API, Nginx) ishga tushirish:
cd infra
docker compose up -d --build
```

Konteynerlar holatini tekshirish:
```bash
docker compose ps
```

---

## 🛡️ Xavfsizlik: AES-256 Shifrlash (`backend/security.py`)

Tashqi davlat portallari bilan integratsiyalashganda xavfsizlik eng yuqori darajada ta'minlangan. Barcha maxfiy ma'lumotlar (login, parol, tokenlar, E-IMZO sertifikatlari) **AES-256-GCM (Authenticated Encryption with Associated Data)** algoritmi yordamida shifrlanadi.

### Python orqali foydalanish namunasi:

```python
from backend.security import encrypt_credential, decrypt_credential, mask_sensitive

# Davlat portali parolini shifrlash:
plain_password = "DavlatTransport2026!Secret"
cipher_text = encrypt_credential(plain_password, associated_data="transport.uz")
print("Shifrlangan:", cipher_text)
# Natija: enc:v1:7sA9F... (URL-safe base64, 96-bit nonce + ciphertext + 128-bit tag)

# Deshifrlash:
decrypted = decrypt_credential(cipher_text, associated_data="transport.uz")
assert decrypted == plain_password

# Loglarda xavfsiz ko'rsatish:
print("Log uchun:", mask_sensitive(plain_password))
# Natija: *******************cret
```

---

## 🗄️ PGBouncer va Database Connection Pooling

100 000 ta avtomobil har 10 soniyada ma'lumot yuborganda PostgreSQL ga to‘g‘ridan-to‘g‘ri 100K ulanish ochish server xotirasini to‘ldirib qo‘yadi. Buning oldini olish uchun PGBouncer **Transaction Pooling** rejimida ishlaydi:

- **Fayl joylashuvi:** `infra/pgbouncer/pgbouncer.ini`
- **Tinglash porti:** `6432`
- **Maksimal mijoz ulanishlari:** `100 000`
- **Real DB ulanishlari:** `20` dan `100` gacha

### AsyncPG sozlamalari (`statement_cache_size = 0`):
PGBouncer transaction pooling rejimida turli mijozlar bitta ulanishni navbatma-navbat ishlatishi sababli, `api_server.py` va `h02_gateway.py` dagi AsyncPG pool sozlamalarida `statement_cache_size=0` parametrini qo‘llash shart:

```python
db_pool = await asyncpg.create_pool(
    dsn=DATABASE_URL,
    min_size=20,
    max_size=100,
    command_timeout=20.0,
    max_inactive_connection_lifetime=300.0,
    statement_cache_size=0, # PGBouncer bilan to'liq muvofiqlik
)
```

---

## 📱 Flutter Mobil Ilovasi (Haydovchi)

Mobil ilova eng og‘ir sharoitlarda (tog‘ yo‘llari, aloqa yo‘q hududlar, agressiv batareya tejamkorligi) ham uzluksiz ishlash uchun loyihalashtirilgan.

### 1. Oflayn GPS Navbati (Offline Queue):
- Agar internet uzilsa yoki tog‘li hududda mashina harakatlansa, GPS koordinatalari yo‘qolmaydi — avtomatik ravishda lokal **SQLite** (`OfflineGpsQueue`) bazasiga saqlanadi.
- Internet tiklangach, ilova serverdagi `/api/v1/gps/bulk` endpointiga saqlangan barcha nuqtalarni 50 tadan to‘plam (Bulk Sync) ko‘rinishida uzatadi va bazadan tozalaydi.

### 2. Batareya Optimizatsiyasidan Chiqarish (Battery Optimization Whitelist):
- Xiaomi (MIUI/HyperOS), Samsung (OneUI) va boshqa Android tizimlari fon jarayonlarini to‘xtatib qo‘ymasligi uchun ilova birinchi marta ochilganda `BatteryOptimizer.requestOptimizationDisable()` orqali haydovchiga ruxsat so‘rovi oynasini ko‘rsatadi.

### 3. Minimalistik Foreground Service Bildirishnomasi:
- Haydovchini bezovta qilmaydigan (ovozsiz, tebranishsiz), lekin real vaqtda avtomobil tezligi va aloqa holatini ko‘rsatib turuvchi xizmat:
  - *Aloqa bor:* `Uyushma GPS • Faol` | `Tezlik: 52 km/soat • Aloqa: Barqaror`
  - *Oflayn rejim:* `Uyushma GPS • Oflayn rejim` | `Tezlik: 0 km/soat • Keshda: 14 ta nuqta`

### 4. Mobil Ilovani Yig'ish (Build APK):

```bash
cd mobile_app

# Bog'liqliklarni yuklash
flutter pub get

# Kod tahlili (0 errors)
flutter analyze

# Production Release APK yig'ish
flutter build apk --release

# APK fayl joylashuvi:
# mobile_app/build/app/outputs/flutter-apk/app-release.apk
```

---

## 📡 REST API & WebSocket Hujjatlari

API server ishga tushgach, to‘liq interaktiv Swagger hujjatlari quyidagi manzilda mavjud bo‘ladi:
👉 `https://uyushma.bmbrutto.uz/docs` yoki `http://localhost:8020/docs`

### Asosiy Endpointlar:

| Metod | Manzil | Tavsif |
| --- | --- | --- |
| `POST` | `/api/v1/auth/request-otp` | Telefon raqamga SMS OTP yuborish |
| `POST` | `/api/v1/auth/verify-otp` | Kodni tasdiqlash va JWT token olish |
| `GET` | `/api/v1/driver/profile` | Haydovchi, avtomobil, 4 ta davlat integratsiyasi va ko‘riklar |
| `POST` | `/api/v1/gps/ping` | Mobil ilovadan bitta GPS nuqtasini yuborish (HTTPS Fallback) |
| `POST` | `/api/v1/gps/bulk` | Oflayn rejimda to‘plangan nuqtalarni ommaviy sinxronlash |
| `GET` | `/api/v1/vehicles/live` | Dispetcher uchun barcha transportlarning oxirgi koordinatalari |
| `WS` | `/api/v1/ws/dispatcher` | Barcha 100K mashinaning jonli oqimini qabul qilish (WebSocket) |
| `POST` | `/api/v1/payments/click` | Click to‘lov shlyuzi webhooki |
| `POST` | `/api/v1/payments/payme` | Payme JSON-RPC to‘lov shlyuzi webhooki |
| `GET` | `/health` | DB va Redis salomatligini tekshirish |

---

## 👥 Mualliflik va Litsenziya

Loyiha O‘zbekiston Respublikasi transport uyushmalari faoliyatini raqamlashtirish uchun ishlab chiqilgan.
Barcha huquqlar himoyalangan © 2026.
