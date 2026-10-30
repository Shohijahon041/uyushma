# Stage 1 hisoboti

**Sana:** 2026-10-30  
**Muhit:** lokal (Docker Desktop, PostgreSQL 16, Redis 7, MinIO), test bazasi `uyushma_test`  
**Holat:** Stage 1 foundation tayyor va tekshirilgan. Production deploy qilinmagan.

## 1. Bajarilgan ishlar

### Infratuzilma

- npm workspaces monorepo: `apps/api`, `apps/web`, `apps/worker`, `apps/bot`.
- Docker Compose: PostgreSQL, Redis, MinIO + private bucket init, API, migration job, worker, bot, web.
- API/web/worker/bot uchun Dockerfile; barcha to'rt image qurildi. API image'da `/health/ready`, web image'da `/uz/login` konteyner ichida tekshirildi.
- `.env.example` (barcha o'zgaruvchilar), `.gitignore` (`.env`, kalitlar, build chiqindilari).
- Root `.env` faqat lokal dev qiymatlari bilan; hech qanday production maxfiy ma'lumot yo'q.

### Ma'lumotlar bazasi va izolyatsiya

- 17 jadval, 13 enum: kompaniyalar, foydalanuvchilar, refresh tokenlar, avtomobillar, yo'nalishlar, tariflar/qoidalar, shartnomalar, to'lovlar, webhook eventlari, SaaS rejalar/obunalar/invoicelar, audit, hujjatlar, Telegram bog'lanishlari.
- 5 ta migratsiya fayli:
  1. boshlang'ich sxema;
  2. RLS, composite FK, immutable audit, helper funksiyalar, grantlar;
  3. bitta avtomobil uchun bitta faol shartnoma (partial unique index);
  4. webhook event unikalligi tenant scope'da;
  5. app rolidan barcha jadvallarda DELETE huquqini olib tashlash.
- Barcha migratsiyalar additiv; hech qanday jadval/ustun/ma'lumot o'chirilmagan.
- App role `uyushma_app`: `NOSUPERUSER`, `NOBYPASSRLS`, jadval egasi emas.
- Cross-tenant FK'lar composite constraint bilan yopilgan.
- Audit log DB trigger bilan append-only.

### API (NestJS modular monolith)

- Auth: kompaniya ro'yxatdan o'tkazish (14 kun trial), login, refresh rotation + reuse detection, logout, `me`.
- RBAC: OWNER/ADMIN/ACCOUNTANT/MANAGER; `JwtAuthGuard`, `RolesGuard`, global throttling.
- Users: ro'yxat, yaratish, rol/faol holatni o'zgartirish, obuna limiti, sessiyalarni revoke qilish.
- Vehicles: CRUD (soft holat), egalik tekshiruvi, obuna limiti, audit.
- Routes: cheklanmagan yo'nalishlar, faollik, audit.
- Tariffs: STANDARD/ROUTE/INDIVIDUAL, ADD/OVERRIDE qoidalari, faqat serverda Decimal hisob.
- Contracts: SELF_USE/LEASE/SERVICE, DRAFT→ACTIVE→TERMINATED, bitta faol shartnoma cheklovi (DB + service).
- Payments: manual va automatic, `Idempotency-Key`, takroriy so'rovda xuddi shu natija, mark-paid, imzoli webhook, event idempotentligi.
- Subscriptions: rejalar, trial, reja almashtirish (limit tekshiruvi), SaaS hisob-fakturalar, alohida moliyaviy oqim.
- Internal billing: `X-Internal-Api-Key`, barcha tenantlar uchun invoice, trial tugamagan tenantlar skip.
- Audit: paginated, filter, faqat o'qish.
- Documents: S3 private presign upload/download, hajm turi tekshiruvi, confirm.
- Telegram: bir martalik bog'lash tokeni, bot API endpointlari, chat→tenant resolution.
- Dashboard aggregate, health live/ready.
- Swagger (`ENABLE_SWAGGER`, lokalda yoqilgan).
- Global validatsiya, bir xil xato formati, request ID, Helmet, CORS allowlist.

### Web (Next.js)

- `uz` (default) va `ru` to'liq message fayllari, `next-intl` routing/middleware.
- Login, kompaniya ro'yxatdan o'tkazish.
- httpOnly cookie BFF: login/register/logout, API proxy, 401 da single-flight refresh, Origin tekshiruvi.
- Sahifalar: dashboard, avtomobillar, yo'nalishlar, tariflar (qoida constructor + server hisob natijasi), shartnomalar, to'lovlar, xodimlar, obuna, audit, sozlamalar/Telegram.
- Rolga mos navigatsiya; barcha moliyaviy ko'rsatkichlar API'dan.
- Responsive shell, status badge'lar, bo'sh holatlar, xato holatlari.

### Worker va bot

- BullMQ worker: `billing` queue, kunlik `billing.run-all` scheduler (03:00 Asia/Tashkent), retry/backoff, graceful shutdown.
- Worker API'ning internal endpointini chaqiradi; DB'ga bevosita ulanmaydi.
- Telegraf bot: `/start <token>`, `/profil`, `/shartnomalar`, `/tolovlar`, `/balans`, `/yordam`; faqat HTTP API.
- Bot DB, S3 yoki internal kalitga ega emas.

## 2. Tekshirish natijalari

### Build va type check

| Buyruq | Natija |
| --- | --- |
| `npm run build -w @uyushma/api` | ✅ o'tdi |
| `npm run build -w @uyushma/web` | ✅ 32 marshrut, type check o'tdi |
| `npm run build -w @uyushma/worker` | ✅ o'tdi |
| `npm run build -w @uyushma/bot` | ✅ o'tdi (bitta `noUncheckedIndexedAccess` xatosi tuzatilgandan keyin) |
| `docker compose --profile app config -q` | ✅ yaroqli |
| `docker compose --profile app build api web worker bot` | ✅ to'rtala image qurildi |
| API image konteynerda | ✅ `/health/ready` = 200 |
| Web image konteynerda | ✅ `/uz/login` = 200 |

### Unit testlar

```text
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
```

Qamrov: tarif dvigateli (ADD/OVERRIDE, priority, rounding, manfiy qiymat), webhook HMAC (valid, tampered, stale, malformed).

### Integratsion testlar (real PostgreSQL)

```text
Test Suites: 2 passed, 2 total
Tests:       19 passed, 19 total
```

Qamrov:

- tenant kontekstisiz 0 qator;
- tenant A faqat o'z avtomobil/kompaniya/shartnomalarini ko'radi;
- API orqali cross-tenant shartnoma/to'lov urinishi rad etiladi;
- DB darajasida cross-tenant vehicle owner va payment→contract composite FK rad etiladi;
- boshqa tenant `Company` qatorini RLS ostida qo'shib bo'lmaydi;
- audit log admin tomonidan ham o'zgartirilmaydi; tenant kontekstisiz ko'rinmaydi;
- tarif hisobi: 300.5 km × 900 + 50 000 + 25 000 → OVERRIDE 300 000;
- payment idempotency: bir xil kalit bir xil ID, DB'da 1 qator; boshqa payload 409;
- imzoli webhook bir marta ishlanadi, takroriy event `idempotent`; noto'g'ri imzo 401; summa mos kelmasa 400;
- refresh rotation va eski token qayta ishlatilganda oila revoke;
- RBAC: buxgalter avtomobil yarata olmaydi, to'lovlarni ko'radi, xodimlar ro'yxatini ko'rmaydi;
- Telegram token bir martalik, bot kaliti talab qilinadi, bog'langan chat summary oladi;
- internal billing kalitisiz 401, kalit bilan ishlaydi;
- SaaS invoice trial tugamaguncha berilmaydi;
- audit logda register/contract/payment/webhook/Telegram amallari mavjud;
- bir avtomobilga ikkinchi faol shartnoma 409.

### Qo'lda API smoke

`register → vehicle → route → tariff → calculate → contract → activate → payment → idempotent replay → mark paid → dashboard` muvaffaqiyatli o'tdi. Dashboard kutilgan summalarni qaytardi.

### Worker

- Worker ishga tushdi, Redis scheduler yaratildi.
- Queue'ga qo'lda `billing.run-all` job qo'yildi va worker uni ishladi.
- Natija: `tenants: 1, created: 0, skipped: 1, failed: 0`, sabab `trial_not_expired`.
- Internal endpoint: kalitsiz 401, noto'g'ri kalit 401, to'g'ri kalit 201.

### Storage (MinIO)

- Presigned PUT: 200.
- `confirm`: 200, `Document.status=UPLOADED`.
- Presigned GET: 200, yuklangan fayl hajmi 14 bayt.
- Noto'g'ri e'lon qilingan hajm 400 bilan rad etildi.
- Private bucket'ga anonymous GET: 403.
- Swagger: 200.

### Web brauzer smoke

- `/uz/login` render bo'ldi.
- Haqiqiy kompaniya hisobi bilan login → `/uz/dashboard`ga o'tdi.
- Dashboard real avtomobil, shartnoma, to'lov va obuna ma'lumotlarini ko'rsatdi.
- Avtomobillar sahifasi ma'lumotlar bilan render bo'ldi; konsolda xato yo'q.
- Til almashtirildi: `/ru/vehicles` sahifasida «Автомобили» va rus navigatsiyasi render bo'ldi.

## 3. Bajarilmagan / scope'dan tashqaridagi ishlar

1. **Production deploy yo'q.** Domain, TLS, server, DNS, firewall, backup tekshirilmagan. Eganing yozma ruxsati kerak.
2. **Haqiqiy to'lov provayderi integratsiyasi yo'q.** Faqat generic imzoli webhook qabul qilinadi; charge yaratish, refund, settlement, reconciliation adapterlari yo'q.
3. **SaaS invoice'ni to'lash oqimi yo'q.** Platforma admin paneli/dunning/card payment hali yo'q.
4. **2FA, parol tiklash, email tasdiqlash, sessiyalar ro'yxati yo'q.**
5. **Email/SMS/push va Telegram notification joblari yo'q.**
6. **Telegram bot real `BOT_TOKEN` bilan sinalmagan** (token berilmagan). Kod va API integratsiyasi testdan o'tgan, botning o'zi long-polling bilan ishga tushirilmagan.
7. **Fayl virus scanning va S3 lifecycle/versioning yo'q.**
8. **Avtomatlashtirilgan E2E (Playwright) va load testlar yo'q.** Brauzer smoke qo'lda bajarilgan.
9. **Platforma superadmin konsoli yo'q;** billing faqat worker/internal API orqali.
10. **Rate limiting va web refresh lock distributed emas.** Bir nechta instansiya uchun Redis asosidagi yechim kerak.
11. **PDF shartnoma generatsiyasi, elektron imzo, hujjat shablonlari yo'q.**
12. **Hukumat litsenziyasi/tender moduli ataylab yo'q.**

## 4. Xavfli / e'tibor talab qiladigan joylar

| Xavf | Ta'sir | Holat |
| --- | --- | --- |
| Dev `.env`da namuna kalitlar | Faqat lokal; Git'ga kirmaydi | Production oldidan almashtirish shart |
| Generic bitta webhook secret | Bitta secret oshkor bo'lsa barcha provayder oqimi | Per-tenant secret + rotation kerak |
| `INTERNAL_API_KEY` bilan kirish | Kalit oshsa billing endpoint ochiladi | Private tarmoq + key rotation majburiy |
| Access token revoke qilinmasligi | 15 daqiqagacha amal qiladi | Qisqa TTL; keyingi bosqichda blacklist |
| App role DB paroli `docker init`da | Faqat lokal | Productionda secret manager |
| `StorageService` konfiguratsiyasi to'liq bo'lmasa API ishga tushmaydi | Start fail | .env'ni to'liq bering; ops tekshiruvi |
| Hujjat `key` javobda | Ichki storage kaliti ko'rinadi | Stage 2 DTO tozalash |
| Swagger production'da | API sxemasi oshkor bo'lishi mumkin | Compose'da `ENABLE_SWAGGER=false` |
| Frontend dashboard manager'ga moliyaviy aggregate ko'rsatadi | Rol siyosati qarori | Kerak bo'lsa rolga qarab yashirish |

## 5. Ma'lumotlar xavfsizligi

- Migratsiyalar faqat qo'shadi; hech qanday `DROP TABLE`, `DROP COLUMN` yoki data-delete amali bajarilmagan.
- App rolidan barcha jadvallarda `DELETE` olib tashlandi; audit `UPDATE/DELETE` trigger bilan yopilgan.
- Production bazaga ulanilmagan. Barcha tekshiruvlar lokal Docker bazasida.
- Testlar alohida `uyushma_test` bazasida ishlaydi va faqat o'sha bazani tozalaydi.

## 6. Keyingi bosqich tavsiyalari

1. **To'lov integratsiyasi:** provayder adapteri, per-tenant secret, charge/refund, reconciliation, webhook retry va alerting.
2. **Auth hardening:** 2FA, parol tiklash, email tasdiqlash, qurilma/sessiya boshqaruvi, audit login failures.
3. **Platforma admin:** superadmin roli, SaaS invoice to'lovi, dunning, tenant lifecycle.
4. **Notifications:** BullMQ notification queue, Telegram/email joblari, retry/dead-letter.
5. **Storage hardening:** virus scan, MIME sniffing, lifecycle, upload limitlar.
6. **Observability:** structured logs, OpenTelemetry, metrics, alertlar, audit export.
7. **Distributed infra:** Redis rate limiting va refresh lock, PgBouncer tekshiruvi.
8. **Testing:** Playwright E2E, k6 load, backup/restore drill.
9. **Deployment:** staging muhiti, TLS, secrets manager, CI/CD, migration job, backup/PITR.

## 7. Takrorlash buyruqlari

```bash
npm test
npm run test:integration
docker compose --profile app config -q
docker compose --profile app build api web
```

Test natijalari ushbu hisobot yozilgan paytdagi oxirgi muvaffaqiyatli yugurishdan olingan.
