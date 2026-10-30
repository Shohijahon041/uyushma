# Arxitektura

## 1. Umumiy ko'rinish

Platforma **modulga bo'lingan monolit** API, alohida worker, alohida Telegram bot va Next.js web BFF'dan iborat.

```text
Brauzer
  │  httpOnly session cookie (uy_at / uy_rt)
  ▼
Next.js web (BFF)
  ├── /api/session/*        login, register, logout; tokenlarni cookie'ga yozadi
  └── /api/proxy/*          API'ga Bearer bilan uzatadi, 401 da refresh qiladi
        │
        ▼
NestJS API  ──────────────► PostgreSQL 16 (RLS, composite FK, audit trigger)
  │      │
  │      └───────────────► S3/MinIO private bucket (presigned URL)
  │
  ├── Redis/BullMQ  ◄────── worker (kunlik billing; internal API chaqiradi)
  └── internal API  ◄────── worker service key bilan

Telegram foydalanuvchisi ──► Telegraf bot ──► API /integrations/telegram (bot key)
```

Muhim qoida: **bot va worker biznes jadvalariga bevosita yozmaydi**. Bot faqat API bilan ishlaydi; worker API'ning internal endpointlarini chaqiradi, business logic va RLS API ichida qoladi.

## 2. Modullar (API)

| Modul | Vazifa |
| --- | --- |
| `auth` | Kompaniya ro'yxatdan o'tkazish, login, refresh rotation, logout, `me` |
| `users` | Xodimlar, rollar, obuna limiti, faolsizlantirishda refresh tokenlarni bekor qilish |
| `vehicles` | Avtopark, egalik, holat, obuna limiti |
| `routes` | Yo'nalishlar |
| `tariffs` | Tariflar, qoidalar, server-side hisoblash |
| `contracts` | Shartnoma hayotiy sikli |
| `payments` | Manual/automatic to'lovlar, idempotentlik, imzoli webhook |
| `subscriptions` | SaaS rejalari, joriy obuna, invoice, internal billing |
| `audit` | Append-only jurnalni o'qish |
| `documents` | Private S3 presign upload/download va tasdiqlash |
| `integrations` | Telegram bog'lash va bot API |
| `dashboard` | Aggregate ko'rsatkichlar |
| `health` | Live/ready probe |
| `jobs` (worker) | BullMQ scheduler |

Har bir modulda controller → service → repository sifatida Prisma transaction ishlatiladi; alohida repository sinflari hozircha service ichidagi `TenantPrismaService` orqali ifodalangan. DTO/validatsiya `class-validator` bilan, global `ValidationPipe` `whitelist + forbidNonWhitelisted`.

## 3. Tenant izolyatsiyasi

### 3.1 Ma'lumot modeli

Har bir tenant jadvalida `tenantId UUID` bor. `Company` — tenant ildizi (`Company.id == tenantId`).

Cross-tenant bog'lanishni ikki qatlam to'sadi:

1. **Composite foreign keys** (`childId, tenantId`) → (`parentId, tenantId`) barcha tenantlararo bog'lanishlarda. Bitta ustunli Prisma FK qulaylik uchun qolgan, lekin composite FK noto'g'ri tenantni rad etadi.
2. **RLS**: barcha tenant jadvallarida `ENABLE` va `FORCE ROW LEVEL SECURITY`, policy `tenantId = app_current_tenant_id()`.

`app_current_tenant_id()` `current_setting('app.tenant_id', true)` ni o'qiydi. Sozlama yo'q bo'lsa `NULL` qaytadi va hech qanday tenant qatori ko'rinmaydi — fail-closed.

### 3.2 Ilova tomoni

`TenantPrismaService.withTenant(tenantId, fn)` har bir so'rovda interaktiv transaction ochadi va:

```sql
SELECT set_config('app.tenant_id', $1::text, true)
```

`true` — transaction-local. Connection pool orqali tenant konteksti boshqa so'rovga oqib o'tmaydi. Tenant ID JWT'dan olinadi; mijoz yuborgan `tenantId` hech qachon ishonchli manba emas.

### 3.3 Pre-auth istisnolar

Quyidagi ishlar uchun `SECURITY DEFINER` funksiyalar bor, ular faqat minimal ma'lumot qaytaradi va `PUBLIC`dan EXECUTE olib tashlangan:

- `app_resolve_tenant_by_slug(slug)` — login uchun faol tenant ID.
- `app_resolve_telegram_chat(chatId)` — bot uchun tenant/foydalanuvchi.
- `app_consume_telegram_link_token(hash, chatId, username)` — bir martalik kodni atomik iste'mol qilish va chatni bog'lash.
- `app_list_active_tenant_ids()` — faqat worker billing uchun tenant ID ro'yxati.

### 3.4 RLS bilan ishlash qoidalari

- API hech qachon superuser yoki jadval egasi bilan ulanmaydi.
- Har qanday yangi tenant jadvali migratsiyada RLS policy va composite FK oladi.
- Tenant kontekstisiz query yozish taqiqlanadi; `PrismaService`ni to'g'ridan-to'g'ri business modulda ishlatmaslik kerak.
- Testlar tenant kontekstisiz 0 qator qaytishini va cross-tenant FK rad etilishini tekshiradi.

## 4. Autentifikatsiya va sessiya

- Parol: `@node-rs/argon2`, Argon2id, 19 MiB, 2 iteratsiya.
- Access JWT: 15 daqiqa, `iss`, `aud`, `typ=access`, tenant + user + role.
- Refresh JWT: 30 kun, DB'da faqat SHA-256 hash saqlanadi.
- Refresh rotation: eski token `revokedAt` bilan belgilanadi. Bekor qilingan token qayta ishlatilsa — token oilasi to'liq revoke qilinadi va audit yoziladi.
- Web tokenlarni JavaScript'ga bermaydi: Next.js BFF httpOnly, SameSite=Lax cookie'da saqlaydi. API'ga Bearer sifatida faqat serverdan uzatiladi.
- Barcha mutatsion BFF so'rovlarida `Origin` tekshiriladi (CSRF himoyasi).
- Parol xatosi va tenant topilmasligi bir xil javob/timing bilan qaytariladi.

## 5. Pul va moliya

- Barcha summalar `NUMERIC(18,2)` / Prisma `Decimal`; JS `number` bilan hisoblanmaydi.
- API'ga summalar **string** sifatida kiradi (`"1250000.00"`) va validatsiyadan o'tadi.
- Tarif dvigateli:
  - boshlang'ich: `baseAmount + pricePerKm × distanceKm`, 2 xona half-up;
  - qoidalar `priority` (keyin `code`) bo'yicha tartiblanadi;
  - `ADD` → jami + summa;
  - `OVERRIDE` → jami = summa (avvalgi jamini almashtiradi).
- Hisob faqat backendda; web faqat natijani ko'rsatadi.
- SaaS obunasi (`Subscription`, `SubscriptionInvoice`) transport to'lovlaridan (`Payment`) alohida jadval va oqimda.

### Idempotentlik

- `Payment` unikal `(tenantId, idempotencyKey)`. Takroriy so'rovda bir xil payload bo'lsa mavjud to'lov qaytadi; boshqa payload bo'lsa 409.
- Webhook event unikal `(tenantId, provider, externalEventId)`. Qayta yuborilgan event `PROCESSED` bo'lsa qayta ishlanmaydi.
- Imzo: `HMAC-SHA256(secret, timestamp + "." + rawBody)`, `x-webhook-signature: sha256=...`, 5 daqiqa oyna, timing-safe taqqoslash.
- Webhook summa payment summasiga mos kelmasa event `FAILED` bo'ladi va 400 qaytadi.
- Billing invoice unikal `(subscriptionId, periodStart)`.

## 6. Audit

`AuditService.record(tx, ...)` biznes mutatsiyasi bilan **bir transactionda** yoziladi. `AuditLog` uchun:

- RLS faqat SELECT va INSERT;
- app rolidan UPDATE/DELETE olib tashlangan;
- `BEFORE UPDATE OR DELETE` trigger `AuditLog is append-only` xatosi bilan to'xtatadi;
- admin ham trigger orqali himoyalangan.

Audit metadata'da PII minimal: email/telefon kabi maydonlar faqat zarur bo'lsa yoziladi.

## 7. Storage

- Private S3 bucket; public access `none`.
- Upload: server presigned PUT yaratadi, obyekt kaliti `tenants/{tenantId}/documents/...`.
- Tasdiqlashda `HeadObject` bilan hajm tekshiriladi, keyin `Document.status=UPLOADED`.
- Download: qisqa muddatli presigned GET (`Content-Disposition: attachment`).
- Fayl turi va hajmi validatsiya qilinadi (PDF/JPEG/PNG/WebP, 20 MB).
- Virus scanning hozircha yo'q — stage 2.

## 8. Worker va bot chegaralari

- **Worker** `billing` queue'da kunlik `billing.run-all` jobini rejalashtiradi (03:00 Asia/Tashkent). Job API'ning `/api/v1/internal/billing/run-all` endpointini `X-Internal-Api-Key` bilan chaqiradi. Tenantlar ro'yxati faqat ID ko'rinishida security-definer funksiyadan olinadi; har bir tenant uchun invoice API ichida RLS bilan yaratiladi.
- **Bot** hech qanday DB yoki S3 kalitiga ega emas. U `BOT_API_KEY` bilan API'ning bot endpointlariga murojaat qiladi; chat → tenant/user xaritasi security-definer funksiya orqali topiladi.
- **Internal API** internetdan himoyalangan bo'lishi kerak (faqat ichki tarmoq / service mesh). Kalit `.env`da, kodda emas.

## 9. Web BFF va i18n

- App Router; `[locale]` segmenti. `uz` default, `ru` tayyor. `next-intl` middleware va message fayllari.
- Barcha autentifikatsiyalangan sahifalar `/api/proxy` orqali ma'lumot oladi; access token muddati tugasa, bitta jarayon ichida single-flight refresh qilinadi.
- Web API URL'lari server-only env (`API_INTERNAL_URL`); brauzerga API manzili yoki token chiqmaydi.
- UI matnlari `messages/uz.json` va `messages/ru.json`da; yangi til qo'shish uchun routing va message fayli qo'shiladi.

## 10. Ma'lumotlar modeli (asosiy)

```text
Company 1─* User
Company 1─* Vehicle *─1 User (owner)
Company 1─* Route 1─* Tariff 1─* TariffRule
Company 1─* Contract *─1 Vehicle, *─1 User(owner), *─0..1 Tariff
Company 1─* Payment *─1 Contract
Company 1─* PaymentWebhookEvent *─0..1 Payment
Company 1─* Subscription *─1 Plan
Company 1─* SubscriptionInvoice *─1 Subscription
Company 1─* AuditLog, Document, TelegramLinkToken, TelegramAccount
```

`Plan` global katalog (faqat SELECT huquqi). Barcha boshqa biznes jadvallar tenant scope'da.

## 11. Arxitektura qarorlari

- **RLS + composite FK:** ilova xatosida ham tenantlararo oqishni to'sadi; test bilan tasdiqlangan.
- **Tenant-scoped transaction:** Prisma uchun eng aniq va audit qilinadigan yondashuv; connection-level kontekstdan farqli o'laroq leak qilmaydi.
- **BFF:** tokenlarni brauzer JS'dan yashiradi, refresh rotationni markazlashtiradi, CSRF origin tekshiruvi qo'shadi.
- **Worker → internal API:** biznes qoidalar bir joyda qoladi; worker'ga DB huquqi berilmaydi.
- **Append-only audit + delete revoke:** moliyaviy tarixni tasodifiy yo'qotishning oldini oladi.

## 12. Ma'lum texnik qarzlar

- Access/refresh tokenlarni bekor qilish uchun global `jti` blacklist yo'q; access token 15 daqiqada o'zi tugaydi. Boshqa qurilmalar sessiyalarini boshqarish stage 2.
- Web BFF refresh lock jarayon ichida (in-memory). Bir nechta web instansiyasida Redis lock kerak.
- Rate limiting hozir in-memory; ko'p instansiyali API uchun Redis storage kerak.
- `TRUST_PROXY` env orqali boshqariladi; faqat X-Forwarded-For'ni o'zi yozadigan ishonchli proxy ortida `true` qilinishi kerak.
- Email, SMS, push va Telegram notification joblari hali yo'q.
